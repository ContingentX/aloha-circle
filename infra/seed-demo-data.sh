#!/usr/bin/env bash
# Create missing demo records (including wheel experiences) and safely
# backfill contract metadata on recognized fixture rows. Existing content is
# never overwritten, and unrecognized key collisions are left untouched.
#   usage: ./infra/seed-demo-data.sh [table]   (default: alohalive)
set -euo pipefail

TABLE="${1:-alohalive}"
REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=5 python3 - \
  "$ROOT/infra/fixtures/demo-data.json" "$TABLE" "$REGION" "${SEED_DRY_RUN:-0}" <<'PY'
import datetime
import json
import re
import subprocess
import sys

fixture_path, table, region, dry_run = sys.argv[1:]
data = json.load(open(fixture_path, encoding='utf-8'))
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
collections = [
    ('nonprofits', 'NPO', 'nonprofit'),
    ('causes', 'CAUSE', 'cause'),
    ('locals', 'LOCAL', 'local'),
    ('endorsements', 'ENDORSE', 'endorsement'),
    ('experiences', 'EXP', 'experience'),
]


def attr(value):
    if isinstance(value, bool):
        return {'BOOL': value}
    if isinstance(value, (int, float)):
        return {'N': str(value)}
    if isinstance(value, list):
        return {'L': [attr(item) for item in value]}
    if isinstance(value, dict):
        return {'M': {key: attr(item) for key, item in value.items()}}
    if value is None:
        return {'NULL': True}
    return {'S': str(value)}

def aws(*arguments):
    return subprocess.run(
        ['aws', *arguments, '--region', region],
        check=False,
        capture_output=True,
        text=True,
    )


def conditional_failure(result):
    return 'ConditionalCheckFailedException' in result.stderr


created = 0
backfilled = 0
preserved = 0
expected = sum(len(data[name]) for name, _, _ in collections)

for collection, prefix, entity_type in collections:
    for fixture in data[collection]:
        slug = fixture['slug']
        fixture_fields = {key: value for key, value in fixture.items() if key != 'slug'}
        if prefix == 'EXP':
            fixture_fields.update({'npoUid': 'seed', 'active': True})
        source = fixture_fields.get('source', 'demo-seed')
        fields = {
            **fixture_fields,
            'entityType': entity_type,
            'entityId': slug,
            'schemaVersion': 1,
            'version': 1,
            'status': 'verified',
            'verified': True,
            'source': source,
            'createdAt': now,
            'updatedAt': now,
        }
        key = {'PK': f'{prefix}#{slug}', 'SK': 'META'}
        item = {name: attr(value) for name, value in {**key, **fields}.items()}
        if dry_run != '1':
            put = aws(
                'dynamodb', 'put-item',
                '--table-name', table,
                '--item', json.dumps(item, ensure_ascii=False, separators=(',', ':')),
                '--condition-expression', 'attribute_not_exists(PK)',
                '--return-values', 'NONE',
            )
            if put.returncode == 0:
                created += 1
                continue
            if not conditional_failure(put):
                sys.stderr.write(put.stderr)
                raise SystemExit(put.returncode)

        backfill = {
            'entityType': entity_type,
            'entityId': slug,
            'schemaVersion': 1,
            'version': 1,
            'status': 'verified',
            'verified': True,
            'source': source,
            'createdAt': now,
            'updatedAt': now,
        }
        if prefix == 'CAUSE':
            backfill.update({
                'nonprofitId': fixture_fields['nonprofitId'],
                'fetchedAt': fixture_fields['fetchedAt'],
            })
        if prefix == 'ENDORSE':
            backfill.update({
                'localId': fixture_fields['localId'],
                'nonprofitId': fixture_fields['nonprofitId'],
            })
        if prefix == 'EXP':
            backfill.update({
                'npoSlug': fixture_fields['npoSlug'],
                'npoUid': 'seed',
                'active': True,
            })

        names = {'#source': 'source'}
        values = {
            ':fixtureSource': attr('demo-seed'),
            ':legacySource': attr('seed'),
        }
        setters = []
        for index, (name, value) in enumerate(backfill.items()):
            name_key = f'#u{index}'
            value_key = f':u{index}'
            names[name_key] = name
            values[value_key] = attr(value)
            setters.append(f'{name_key} = if_not_exists({name_key}, {value_key})')

        if prefix == 'NPO':
            fingerprints = [('name', fixture_fields['name'])]
            source_condition = '(#source = :legacySource OR #source = :fixtureSource)'
        elif prefix == 'CAUSE':
            fingerprints = [
                ('title', fixture_fields['title']),
                ('nonprofit', fixture_fields['nonprofit']),
                ('url', fixture_fields['url']),
            ]
            source_condition = '(attribute_not_exists(#source) OR #source = :legacySource OR #source = :fixtureSource)'
        elif prefix == 'LOCAL':
            fingerprints = [('name', fixture_fields['name']), ('town', fixture_fields['town'])]
            source_condition = '(attribute_not_exists(#source) OR #source = :legacySource OR #source = :fixtureSource)'
        elif prefix == 'ENDORSE':
            fingerprints = [
                ('local', fixture_fields['local']),
                ('nonprofit', fixture_fields['nonprofit']),
                ('verdict', fixture_fields['verdict']),
            ]
            source_condition = '(attribute_not_exists(#source) OR #source = :legacySource OR #source = :fixtureSource)'
        else:
            fingerprints = [
                ('title', fixture_fields['title']),
                ('npoSlug', fixture_fields['npoSlug']),
                ('npoUid', 'seed'),
            ]
            source_condition = '(attribute_not_exists(#source) OR #source = :legacySource OR #source = :fixtureSource)'

        conditions = []
        for index, (name, value) in enumerate(fingerprints):
            name_key = f'#c{index}'
            value_key = f':c{index}'
            names[name_key] = name
            values[value_key] = attr(value)
            conditions.append(f'{name_key} = {value_key}')
        conditions.append(source_condition)

        update_expression = 'SET ' + ', '.join(setters)
        condition_expression = ' AND '.join(conditions)
        expression = f'{update_expression} {condition_expression}'
        used_names = set(re.findall(r'#[A-Za-z0-9]+', expression))
        used_values = set(re.findall(r':[A-Za-z0-9]+', expression))
        if used_names != set(names) or used_values != set(values):
            raise SystemExit(
                f'invalid expression aliases for {prefix}#{slug}: '
                f'names={set(names) - used_names} values={set(values) - used_values}'
            )
        if dry_run == '1':
            backfilled += 1
            continue

        update = aws(
            'dynamodb', 'update-item',
            '--table-name', table,
            '--key', json.dumps({name: attr(value) for name, value in key.items()}, separators=(',', ':')),
            '--update-expression', update_expression,
            '--condition-expression', condition_expression,
            '--expression-attribute-names', json.dumps(names, separators=(',', ':')),
            '--expression-attribute-values', json.dumps(values, ensure_ascii=False, separators=(',', ':')),
            '--return-values', 'NONE',
        )
        if update.returncode == 0:
            backfilled += 1
        elif conditional_failure(update):
            preserved += 1
        else:
            sys.stderr.write(update.stderr)
            raise SystemExit(update.returncode)

if created + backfilled + preserved != expected:
    raise SystemExit(f'processed {created + backfilled + preserved} of {expected} fixture records')
if dry_run == '1':
    print(f"==> Dry run validated {expected} demo records for table '{table}' in {region}")
    raise SystemExit(0)
print(
    f"==> Demo records: created={created} metadata_backfilled={backfilled} "
    f"unrecognized_preserved={preserved} table='{table}' region={region}"
)
PY
