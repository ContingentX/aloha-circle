import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicApiClient } from '../src/public-api-client.js';

function response(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 201,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

test('public API client accepts only HTTPS or loopback and preserves Dynamo IDs', async () => {
  assert.throws(
    () => createPublicApiClient({ baseUrl: 'http://api.example.test' }),
    /must be HTTPS or an HTTP loopback URL/,
  );
  assert.throws(
    () => createPublicApiClient({ baseUrl: 'https://user:secret@api.example.test' }),
    /must be HTTPS or an HTTP loopback URL/,
  );

  let request;
  const result = await createPublicApiClient({
    baseUrl: 'https://api.example.test/dev/',
    fetchImpl: async (url, options) => {
      request = { url: url.href, options };
      return response({
        visitor: { id: 'e944b4f7-53bc-4484-96b2-84ea26a9499c', name: 'Kai', interests: ['ocean'] },
        match: {
          id: '4303c0b5-d13f-41d5-b96f-1320bc9deaa4',
          visitorId: 'e944b4f7-53bc-4484-96b2-84ea26a9499c',
          localId: 'keoni',
          causeId: 'reef-restoration',
          score: 12,
          scoreReceipt: { total: 12 },
        },
      });
    },
  }).createVisitorAndMatch({ name: 'Kai', interests: ['ocean'] });

  assert.equal(request.url, 'https://api.example.test/dev/api/visitors');
  assert.deepEqual(JSON.parse(request.options.body), { name: 'Kai', interests: ['ocean'] });
  assert.equal(request.options.headers.authorization, undefined);
  assert.equal(result.visitor.id, 'e944b4f7-53bc-4484-96b2-84ea26a9499c');
  assert.equal(result.match.localId, 'keoni');
  assert.equal(result.match.causeId, 'reef-restoration');
});

test('public API client rejects a match without a matching scoring receipt', async () => {
  const client = createPublicApiClient({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => response({
      visitor: { id: 'e944b4f7-53bc-4484-96b2-84ea26a9499c' },
      match: {
        id: '4303c0b5-d13f-41d5-b96f-1320bc9deaa4',
        visitorId: 'e944b4f7-53bc-4484-96b2-84ea26a9499c',
        localId: 'keoni', causeId: 'reef', score: 12, scoreReceipt: { total: 11 },
      },
    }),
  });
  await assert.rejects(
    client.createVisitorAndMatch({ name: 'Kai', interests: ['ocean'] }),
    /invalid match contract/,
  );
});
