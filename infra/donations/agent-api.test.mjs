import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentApi, createDynamoAgentStore } from './agent-api.mjs';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
  const writes = [];
  return {
    writes,
    async list(collection) {
      return structuredClone(data.get(collection) ?? []);
    },
    async insert(collection, record) {
      const records = data.get(collection) ?? [];
      records.push(structuredClone(record));
      data.set(collection, records);
      writes.push({ collection, record: structuredClone(record) });
      return record;
    },
  };
}

function testApi(store = memoryStore()) {
  let nextId = 0;
  return createAgentApi({
    store,
    uuid: () => `test-id-${++nextId}`,
    now: () => new Date('2026-08-29T12:00:00.000Z'),
  });
}

test('seeded causes and enriched nonprofits are immediately available', async () => {
  const api = testApi();
  const causes = await api.handle({ method: 'GET', path: '/api/causes' });
  assert.equal(causes.status, 200);
  assert.equal(causes.body.length, 3);
  assert.equal(causes.body[0].title, 'Saturday reef cleanup at Kahekili Beach');

  const nonprofits = await api.handle({ method: 'GET', path: '/api/nonprofits' });
  assert.equal(nonprofits.status, 200);
  const reef = nonprofits.body.find((item) => item.name === 'Maui Reef Guardians');
  assert.equal(reef.endorsements, 2);
  assert.equal(reef.helpingNow, 2);
});

test('visitor signup persists a deterministic positive match', async () => {
  const store = memoryStore();
  const api = testApi(store);
  const result = await api.handle({
    method: 'POST',
    path: '/api/visitors',
    body: { name: 'Kai', interests: ['diving', 'ocean'] },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.visitor.name, 'Kai');
  assert.equal(result.body.match.localName, 'Keoni');
  assert.equal(result.body.match.localTown, 'Lahaina');
  assert.equal(result.body.match.cause, 'Saturday reef cleanup at Kahekili Beach');
  assert.equal(result.body.match.score, 22);
  assert.equal(
    result.body.match.why,
    "You and Keoni both care about diving and ocean. Reef Guardians need 20 volunteers this Saturday to remove debris after last week's swell.",
  );
  assert.equal(store.writes[0].collection, 'visitors');
  assert.equal(store.writes[1].collection, 'matches');
});

test('local, nonprofit, and endorsement writes retain harness response shapes', async () => {
  const store = memoryStore();
  const api = testApi(store);

  const local = await api.handle({
    method: 'POST', path: '/api/locals', body: { name: 'Noa', interests: [], town: '' },
  });
  assert.equal(local.status, 201);
  assert.deepEqual(local.body.interests, []);
  assert.deepEqual(local.body.causes, []);
  assert.equal(local.body.town, null);
  assert.equal(local.body.verified, false);

  const nonprofit = await api.handle({
    method: 'POST', path: '/api/nonprofits', body: { name: 'Maui Helpers', causeTags: [] },
  });
  assert.equal(nonprofit.status, 201);
  assert.deepEqual(nonprofit.body.needs, []);
  assert.equal(nonprofit.body.website, null);

  const endorsement = await api.handle({
    method: 'POST',
    path: '/api/endorsements',
    body: { local: 'Noa', nonprofit: 'Maui Helpers', verdict: 'helping_now' },
  });
  assert.equal(endorsement.status, 201);
  assert.equal('verified' in endorsement.body, false);

  const listed = await api.handle({ method: 'GET', path: '/api/nonprofits' });
  const helpers = listed.body.find((item) => item.name === 'Maui Helpers');
  assert.equal(helpers.endorsements, 0);
  assert.equal(helpers.helpingNow, 0);
});

test('validation errors match the local harness contract', async () => {
  const api = testApi();
  const cases = [
    ['POST', '/api/visitors', { name: 'Kai', interests: [] }, 'name and interests[] are required'],
    ['POST', '/api/locals', { name: 'Noa' }, 'name and interests[] are required'],
    ['POST', '/api/nonprofits', { name: 'Helpers' }, 'name and causeTags[] are required'],
    [
      'POST',
      '/api/endorsements',
      { local: 'Noa', nonprofit: 'Helpers', verdict: 'maybe' },
      'local, nonprofit and verdict (helping_now|generally_helping|not_sure|causing_concern) are required',
    ],
  ];

  for (const [method, path, body, error] of cases) {
    const result = await api.handle({ method, path, body });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error });
  }
});

test('unknown paths are left to the main Lambda router', async () => {
  const api = testApi();
  assert.equal(await api.handle({ method: 'GET', path: '/experiences' }), null);
});

test('unverified public records cannot change trusted matches or endorsement counts', async () => {
  const store = memoryStore();
  const api = testApi(store);
  await api.handle({
    method: 'POST',
    path: '/api/locals',
    body: {
      name: 'Unverified attacker',
      interests: ['diving', 'ocean'],
      causes: ['reef', 'ocean', 'diving'],
    },
  });
  for (const nonprofit of ['Maui Reef Guardians', 'Maui Food Hub', 'Aloha Trail Keepers']) {
    for (let index = 0; index < 20; index += 1) {
      await api.handle({
        method: 'POST',
        path: '/api/endorsements',
        body: { local: `fake-${index}`, nonprofit, verdict: 'causing_concern' },
      });
    }
  }

  const visitor = await api.handle({
    method: 'POST',
    path: '/api/visitors',
    body: { name: 'Kai', interests: ['diving', 'ocean'] },
  });
  assert.equal(visitor.status, 201);
  assert.equal(visitor.body.match.localName, 'Keoni');
  assert.equal(visitor.body.match.score, 22);

  const nonprofits = await api.handle({ method: 'GET', path: '/api/nonprofits' });
  const reef = nonprofits.body.find((item) => item.name === 'Maui Reef Guardians');
  assert.equal(reef.endorsements, 2);
  assert.equal(reef.helpingNow, 2);
});

test('Dynamo adapter paginates, hides keys, and writes an isolated namespace', async () => {
  class FakeQueryCommand {
    constructor(input) { this.input = input; }
  }
  class FakePutCommand {
    constructor(input) { this.input = input; }
  }
  const commands = [];
  const pages = [
    { Items: [{ PK: 'hidden', SK: 'META', record: { id: 'one' } }], LastEvaluatedKey: { PK: 'next' } },
    { Items: [{ PK: 'hidden', SK: 'META', record: { id: 'two' } }] },
  ];
  const client = {
    async send(command) {
      commands.push(command);
      return command instanceof FakeQueryCommand ? pages.shift() : {};
    },
  };
  const store = createDynamoAgentStore({
    client,
    table: 'test-table',
    QueryCommand: FakeQueryCommand,
    PutCommand: FakePutCommand,
  });

  assert.deepEqual(await store.list('locals'), [{ id: 'one' }, { id: 'two' }]);
  assert.equal(commands[0].input.ConsistentRead, true);
  assert.equal(commands[0].input.ExpressionAttributeValues[':pk'], 'AGENT#LOCALS');
  assert.deepEqual(commands[1].input.ExclusiveStartKey, { PK: 'next' });

  const record = { id: 'local-3', createdAt: '2026-08-29T12:00:00.000Z', name: 'Noa' };
  await store.insert('locals', record);
  const put = commands.at(-1).input;
  assert.equal(put.TableName, 'test-table');
  assert.equal(put.Item.PK, 'AGENT#LOCALS');
  assert.equal(put.Item.SK, 'ITEM#local-3');
  assert.deepEqual(put.Item.record, record);
  assert.equal(put.Item.ttl, 1803556800);
  assert.equal(put.ConditionExpression, 'attribute_not_exists(PK)');
});
