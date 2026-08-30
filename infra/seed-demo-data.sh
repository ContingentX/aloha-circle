#!/usr/bin/env bash
# Seed the alohalive DynamoDB table with the demo data plane (nonprofits,
# causes, locals, endorsements, wheel experiences) from infra/fixtures/demo-data.json.
# Idempotent: items are keyed by fixture slug, so re-runs overwrite in place.
# The Aloha agent later writes the same item shapes to replace this data.
#   usage: ./infra/seed-demo-data.sh [table]   (default: alohalive)
set -euo pipefail

TABLE="${1:-alohalive}"
REGION="us-east-1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$ROOT/infra/fixtures/demo-data.json" "$TABLE" <<'EOF' | while read -r chunk; do
import json, sys

data = json.load(open(sys.argv[1], encoding='utf-8'))
now = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()

def attr(v):
    if isinstance(v, bool): return {'BOOL': v}
    if isinstance(v, (int, float)): return {'N': str(v)}
    if isinstance(v, list): return {'L': [attr(x) for x in v]}
    if v is None: return {'NULL': True}
    return {'S': str(v)}

items = []
def add(prefix, slug, fields):
    item = {'PK': f'{prefix}#{slug}', 'SK': 'META', 'createdAt': now, **fields}
    items.append({k: attr(v) for k, v in item.items()})

for np in data['nonprofits']:
    add('NPO', np['slug'], {k: v for k, v in np.items() if k != 'slug'})
for c in data['causes']:
    add('CAUSE', c['slug'], {k: v for k, v in c.items() if k != 'slug'})
for l in data['locals']:
    add('LOCAL', l['slug'], {k: v for k, v in l.items() if k != 'slug'})
for e in data['endorsements']:
    add('ENDORSE', e['slug'], {k: v for k, v in e.items() if k != 'slug'})
for x in data.get('experiences', []):
    add('EXP', x['slug'], {**{k: v for k, v in x.items() if k != 'slug'}, 'npoUid': 'seed', 'active': True})

for i in range(0, len(items), 25):
    chunk = {sys.argv[2]: [{'PutRequest': {'Item': it}} for it in items[i:i+25]]}
    print(json.dumps(chunk, ensure_ascii=False))
EOF
  echo "$chunk" > /tmp/alohalive-seed-chunk.json
  aws dynamodb batch-write-item --region "$REGION" \
    --request-items file:///tmp/alohalive-seed-chunk.json \
    --query 'UnprocessedItems' --output json
done
echo "==> Seeded demo data into table '$TABLE'"
