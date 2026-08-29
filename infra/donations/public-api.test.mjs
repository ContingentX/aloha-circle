import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicApiError } from './public-api-core.mjs';
import { createDynamoPublicStore, createPublicApi } from './public-api.mjs';

class ScanCommand {
  constructor(input) {
    this.input = input;
  }
}

class PutCommand {
  constructor(input) {
    this.input = input;
  }
}

const trustedCause = {
  PK: 'CAUSE#reef', SK: 'META', entityId: 'reef',
  title: 'Restore the reef', summary: 'A source-backed need.',
  nonprofit: 'Maui Helpers', nonprofitId: 'maui-helpers',
  causeTags: ['ocean'], urgency: 3, action: 'Help today.',
  url: 'https://example.test/reef', source: 'test-feed',
  fetchedAt: '2026-08-29T00:00:00.000Z', status: 'verified', verified: true,
};

const trustedLocal = {
  PK: 'LOCAL#keoni', SK: 'META', entityId: 'keoni', name: 'Keoni', town: 'Lahaina',
  interests: ['ocean'], causes: ['ocean'], status: 'verified', verified: true,
};

const trustedNonprofit = {
  PK: 'NPO#maui-helpers', SK: 'META', entityId: 'maui-helpers', name: 'Maui Helpers',
  causeTags: ['ocean'], needs: ['volunteers'], website: 'https://example.test/',
  status: 'verified', verified: true,
};

const trustedEndorsement = {
  PK: 'ENDORSE#one', SK: 'META', entityId: 'one', local: 'Keoni', localId: 'keoni',
  nonprofit: 'Maui Helpers', nonprofitId: 'maui-helpers', verdict: 'helping_now',
  status: 'verified', verified: true,
};

test('Dynamo store paginates one cached trusted scan and projects anonymous reads', async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      const { input } = command;
      if (command instanceof PutCommand) return {};
      if (input.ProjectionExpression === 'PK, SK') {
        return input.ExclusiveStartKey
          ? { Items: [{ PK: 'MATCH#m', SK: 'META' }] }
          : { Items: [{ PK: 'NPO#maui-helpers', SK: 'META' }], LastEvaluatedKey: { PK: 'page-2' } };
      }
      if (input.ExpressionAttributeValues?.[':p'] === 'USER#') {
        return input.ExclusiveStartKey
          ? { Items: [{ PK: 'USER#uid-2', orgName: 'Second Org', domain: 'second.test' }] }
          : { Items: [{ PK: 'USER#uid-1', orgName: 'First Org', domain: 'first.test' }], LastEvaluatedKey: { PK: 'users-2' } };
      }
      return input.ExclusiveStartKey
        ? { Items: [trustedCause, trustedLocal, trustedEndorsement] }
        : { Items: [trustedNonprofit], LastEvaluatedKey: { PK: 'trusted-2' } };
    },
  };
  const fixed = new Date('2026-08-29T12:00:00.000Z');
  const store = createDynamoPublicStore({
    client, table: 'alohalive', PutCommand, ScanCommand,
    randomId: () => 'generated-id', now: () => fixed,
  });

  const [nonprofits, causes, locals, endorsements] = await Promise.all([
    store.list('NPO'), store.list('CAUSE'), store.list('LOCAL'), store.list('ENDORSE'),
  ]);
  assert.equal(nonprofits.length, 1);
  assert.equal(causes.length, 1);
  assert.equal(locals.length, 1);
  assert.equal(endorsements.length, 1);
  const trustedScans = calls.filter((call) =>
    call instanceof ScanCommand && call.input.FilterExpression.includes('verified = :yes'));
  assert.equal(trustedScans.length, 2, 'one two-page scan should serve every trusted prefix');
  assert.deepEqual(trustedScans[1].input.ExclusiveStartKey, { PK: 'trusted-2' });
  assert.ok(trustedScans[0].input.ProjectionExpression);
  assert.equal(trustedScans[0].input.ProjectionExpression.includes('note'), false);
  assert.equal(trustedScans[0].input.ExpressionAttributeNames['#url'], 'url');
  assert.equal(trustedScans[0].input.ProjectionExpression.split(/,\s*/).includes('#url'), true);

  await store.list('NPO');
  assert.equal(calls.filter((call) =>
    call instanceof ScanCommand && call.input.FilterExpression.includes('verified = :yes')).length, 2);

  const profiles = await store.verifiedNonprofitProfiles();
  assert.equal(profiles.length, 2);
  const profileScans = calls.filter((call) =>
    call instanceof ScanCommand && call.input.ExpressionAttributeValues?.[':p'] === 'USER#');
  assert.equal(profileScans.length, 2);
  assert.equal(profileScans[0].input.ProjectionExpression, 'orgName, #domain');

  assert.deepEqual(await store.counts(), {
    nonprofits: 1, causes: 0, locals: 0, visitors: 0, endorsements: 0, matches: 1,
  });
  const countScans = calls.filter((call) =>
    call instanceof ScanCommand && call.input.ProjectionExpression === 'PK, SK');
  assert.equal(countScans.length, 2);
});

test('Dynamo store invalidates only the caches affected by pending and verified writes', async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof PutCommand) return {};
      return { Items: [trustedNonprofit] };
    },
  };
  const fixed = new Date('2026-08-29T12:00:00.000Z');
  const store = createDynamoPublicStore({
    client, table: 'alohalive', PutCommand, ScanCommand,
    randomId: () => 'generated-id', now: () => fixed,
  });
  await store.list('NPO');
  await store.counts();
  await store.put('LOCAL', { name: 'Kai', status: 'pending', verified: false }, { ttlDays: 180 });
  await store.list('NPO');
  await store.counts();

  const write = calls.find((call) => call instanceof PutCommand).input.Item;
  assert.equal(calls.find((call) => call instanceof PutCommand).input.ConditionExpression,
    'attribute_not_exists(PK)');
  assert.deepEqual({
    PK: write.PK, SK: write.SK, entityType: write.entityType, entityId: write.entityId,
    schemaVersion: write.schemaVersion, version: write.version,
  }, {
    PK: 'LOCAL#generated-id', SK: 'META', entityType: 'local', entityId: 'generated-id',
    schemaVersion: 1, version: 1,
  });
  assert.equal(write.ttl, Math.floor(fixed.getTime() / 1000) + 180 * 24 * 60 * 60);
  assert.equal(calls.filter((call) =>
    call instanceof ScanCommand && call.input.ProjectionExpression !== 'PK, SK').length, 1);
  assert.equal(calls.filter((call) =>
    call instanceof ScanCommand && call.input.ProjectionExpression === 'PK, SK').length, 2);

  await store.put('CAUSE', { ...trustedCause, status: 'verified', verified: true });
  await store.list('NPO');
  assert.equal(calls.filter((call) =>
    call instanceof ScanCommand && call.input.ProjectionExpression !== 'PK, SK').length, 2);
  const verifiedWrite = calls.filter((call) => call instanceof PutCommand)[1].input.Item;
  assert.deepEqual({
    PK: verifiedWrite.PK, SK: verifiedWrite.SK, entityType: verifiedWrite.entityType,
    entityId: verifiedWrite.entityId, version: verifiedWrite.version,
  }, {
    PK: 'CAUSE#generated-id', SK: 'META', entityType: 'cause',
    entityId: 'generated-id', version: 1,
  });
});

test('Dynamo store refreshes trusted and profile caches exactly at TTL expiry', async () => {
  let clockMs = Date.parse('2026-08-29T12:00:00.000Z');
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      return command.input.ExpressionAttributeValues?.[':p'] === 'USER#'
        ? { Items: [{ PK: 'USER#uid', orgName: 'Org', domain: 'org.test' }] }
        : { Items: [trustedNonprofit] };
    },
  };
  const store = createDynamoPublicStore({
    client, table: 'alohalive', PutCommand, ScanCommand,
    randomId: () => 'generated-id', now: () => new Date(clockMs), cacheTtlMs: 3_000,
  });
  await store.list('NPO');
  await store.verifiedNonprofitProfiles();
  clockMs += 2_999;
  await store.list('NPO');
  await store.verifiedNonprofitProfiles();
  assert.equal(calls.length, 2);
  clockMs += 1;
  await store.list('NPO');
  await store.verifiedNonprofitProfiles();
  assert.equal(calls.length, 4);
});

function memoryStore(initial = {}) {
  const records = new Map(Object.entries(initial).map(([key, value]) => [key, [...value]]));
  const writes = [];
  let sequence = 0;
  return {
    writes,
    async counts() {
      return {
        nonprofits: records.get('NPO')?.length ?? 0,
        causes: records.get('CAUSE')?.length ?? 0,
        locals: records.get('LOCAL')?.length ?? 0,
        visitors: records.get('VISITOR')?.length ?? 0,
        endorsements: records.get('ENDORSE')?.length ?? 0,
        matches: records.get('MATCH')?.length ?? 0,
      };
    },
    async list(prefix) {
      return records.get(prefix) ?? [];
    },
    async verifiedNonprofitProfiles() {
      return records.get('USER') ?? [];
    },
    async put(prefix, fields, options = {}) {
      sequence += 1;
      const id = `${prefix.toLowerCase()}-${sequence}`;
      const record = {
        PK: `${prefix}#${id}`, SK: 'META', entityId: id,
        id, ...fields, createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z',
      };
      records.set(prefix, [...(records.get(prefix) ?? []), record]);
      writes.push({ prefix, fields, options, record });
      return record;
    },
  };
}

test('public routes create pending records with TTL and reject coerced object fields', async () => {
  const store = memoryStore();
  const api = createPublicApi({ store });

  assert.equal((await api.handle({
    method: 'POST', path: '/api/nonprofits',
    rawBody: JSON.stringify({ name: '  Reef Helpers ', causeTags: ['Ocean', ' ocean ', {}, 'Reef'], website: 'javascript:alert(1)' }),
  })).statusCode, 202);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/locals',
    rawBody: JSON.stringify({ name: ' Kai ', interests: ['Ocean', 'ocean'], causes: ['reef'], town: {} }),
  })).statusCode, 201);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/endorsements',
    rawBody: JSON.stringify({ local: 'Kai', localId: 'kai', nonprofit: 'Reef Helpers', nonprofitId: 'reef-helpers', verdict: 'helping_now', note: {} }),
  })).statusCode, 202);

  for (const write of store.writes) {
    assert.equal(write.fields.status, 'pending');
    assert.equal(write.fields.verified, false);
    assert.equal(write.options.ttlDays, 180);
  }
  assert.deepEqual(store.writes[0].fields.causeTags, ['Ocean', 'Reef']);
  assert.equal(store.writes[0].fields.website, null);
  assert.equal(store.writes[1].fields.name, 'Kai');
  assert.deepEqual(store.writes[1].fields.interests, ['Ocean']);
  assert.equal(store.writes[1].fields.town, null);
  assert.equal(store.writes[2].fields.note, null);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/nonprofits', rawBody: JSON.stringify({ name: {}, causeTags: ['ocean'] }),
  })).statusCode, 400);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/endorsements',
    rawBody: JSON.stringify({ local: {}, nonprofit: 'Reef Helpers', verdict: 'helping_now' }),
  })).statusCode, 400);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/endorsements',
    rawBody: JSON.stringify({ local: 'Kai', localId: 'bad/id', nonprofit: 'Reef Helpers', verdict: 'helping_now' }),
  })).statusCode, 400);
  assert.equal((await api.handle({
    method: 'POST', path: '/api/endorsements',
    rawBody: JSON.stringify({ local: 'Kai', localId: 'a'.repeat(121), nonprofit: 'Reef Helpers', verdict: 'helping_now' }),
  })).statusCode, 400);
  assert.equal(store.writes.length, 3, 'invalid requests must not write records');
});

test('cause route returns the complete source-backed CauseSignal', async () => {
  const response = await createPublicApi({ store: memoryStore({ CAUSE: [trustedCause] }) })
    .handle({ method: 'GET', path: '/api/causes' });
  assert.deepEqual(response, {
    statusCode: 200,
    body: [{
      id: 'reef', source: 'test-feed', url: 'https://example.test/reef',
      title: 'Restore the reef', causeTags: ['ocean'], urgency: 3,
      summary: 'A source-backed need.', fetchedAt: '2026-08-29T00:00:00.000Z',
      nonprofit: 'Maui Helpers', nonprofitId: 'maui-helpers', action: 'Help today.',
    }],
  });
});

test('visitor matching ignores pending records and duplicate tags cannot inflate score', async () => {
  const store = memoryStore({
    LOCAL: [trustedLocal, { ...trustedLocal, PK: 'LOCAL#pending', entityId: 'pending', status: 'pending', verified: false }],
    CAUSE: [trustedCause],
    ENDORSE: [{ ...trustedEndorsement, status: 'pending', verified: false }],
  });
  const api = createPublicApi({ store });
  const response = await api.handle({
    method: 'POST', path: '/api/visitors',
    rawBody: JSON.stringify({ name: 'Leilani', interests: ['ocean', 'Ocean', ' ocean ', {}] }),
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body.visitor.interests, ['ocean']);
  assert.equal(response.body.match.localId, 'keoni');
  assert.equal(response.body.match.causeId, 'reef');
  assert.equal(response.body.match.score, 10);
  assert.equal(store.writes.find((write) => write.prefix === 'VISITOR').options.ttlDays, 30);
  assert.equal(store.writes.find((write) => write.prefix === 'MATCH').options.ttlDays, 30);
});

test('nonprofit listing excludes pending counts and never exposes a Firebase UID', async () => {
  const store = memoryStore({
    NPO: [trustedNonprofit, { ...trustedNonprofit, PK: 'NPO#pending', entityId: 'pending', name: 'Pending Org', status: 'pending', verified: false }],
    ENDORSE: [trustedEndorsement, { ...trustedEndorsement, PK: 'ENDORSE#pending', status: 'pending', verified: false }],
    USER: [
      {
        PK: 'USER#super-secret-firebase-uid', orgName: 'Signed Up Org', domain: 'signed-up.example',
        email: 'private@example.test', photoURL: 'https://private.example.test/photo', ver_proofEmail: 'proof@example.test',
      },
      { PK: 'USER#another-uid', orgName: 'Signed Up Org', domain: 'SIGNED-UP.EXAMPLE' },
      { PK: 'USER#third-uid', orgName: 'Signed Up Org', domain: 'duplicate-name.example' },
    ],
  });
  const response = await createPublicApi({ store }).handle({ method: 'GET', path: '/api/nonprofits' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 2);
  assert.equal(response.body.some((record) => record.name === 'Pending Org'), false);
  assert.equal(response.body.find((record) => record.name === 'Maui Helpers').helpingNow, 1);
  const signup = response.body.find((record) => record.name === 'Signed Up Org');
  assert.match(signup.id, /^signup-[a-f0-9]{16}$/);
  assert.deepEqual(Object.keys(signup).sort(), [
    'causeTags', 'endorsements', 'helpingNow', 'id', 'name', 'needs', 'website',
  ]);
  assert.equal(JSON.stringify(response.body).includes('super-secret-firebase-uid'), false);
  assert.equal(JSON.stringify(response.body).includes('private@example.test'), false);
});

test('public route parser reports malformed JSON as a 400-class public API error', async () => {
  const api = createPublicApi({ store: memoryStore() });
  await assert.rejects(
    api.handle({ method: 'POST', path: '/api/locals', rawBody: '{' }),
    (error) => error instanceof PublicApiError && error.status === 400,
  );
});
