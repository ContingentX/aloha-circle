import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BRIDGE_TOOL_NAMES,
  BridgeError,
  assertPublicHttpsUrl,
  createBridgeDaemon,
  createBridgeMcpServer,
  createInMemoryCredentialStore,
  createToolInvoker,
  requireLoopback,
  takeApiTokenFromEnvironment,
} from '../demo/brightdata-mcp-bridge.mjs';

const TEST_TOKEN = 'test-token-kept-only-in-memory-12345';
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('bridge binds loopback, rejects non-loopback peers, and closes its listener', async () => {
  let nextCalled = false;
  const blocked = { statusCode: null, body: null };
  const response = {
    status(code) {
      blocked.statusCode = code;
      return this;
    },
    send(body) {
      blocked.body = body;
      return this;
    },
  };
  requireLoopback({ socket: { remoteAddress: '10.0.0.7' } }, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.deepEqual(blocked, { statusCode: 403, body: 'Forbidden' });

  const daemon = createBridgeDaemon({
    apiToken: TEST_TOKEN,
    port: 0,
    lookup: publicLookup,
    upstream: async () => ({ content: [{ type: 'text', text: 'fixture' }] }),
  });
  const address = await daemon.start();
  const server = daemon.server;
  try {
    assert.equal(address.host, '127.0.0.1');
    const health = await fetch(`http://${address.host}:${address.port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, configured: true });
    const setup = await fetch(`http://${address.host}:${address.port}/setup`);
    assert.equal(setup.status, 404);
  } finally {
    await daemon.close();
  }
  assert.equal(server.listening, false);
});

test('credential leaves the environment, stays in memory, and never reaches errors', async () => {
  const env = { BRIGHTDATA_API_TOKEN: TEST_TOKEN };
  const token = takeApiTokenFromEnvironment(env);
  assert.equal('BRIGHTDATA_API_TOKEN' in env, false);
  const credentialStore = createInMemoryCredentialStore(token);
  let observedToken = false;
  const invoke = createToolInvoker({
    credentialStore,
    lookup: publicLookup,
    upstream: async ({ apiToken }) => {
      observedToken = apiToken === TEST_TOKEN;
      throw new Error(`raw upstream secret ${apiToken}`);
    },
  });
  await assert.rejects(
    invoke('search_engine', { query: 'Maui needs' }),
    (error) => error instanceof BridgeError
      && error.code === 'UPSTREAM_TOOL_FAILED'
      && !error.message.includes(TEST_TOKEN)
      && !error.message.includes('raw upstream'),
  );
  assert.equal(observedToken, true);
  assert.equal(Object.values(credentialStore).includes(TEST_TOKEN), false);
  credentialStore.clear();
  await assert.rejects(
    credentialStore.use(async () => null),
    (error) => error instanceof BridgeError && error.code === 'BRIDGE_NOT_CONFIGURED',
  );
});

test('MCP server exposes exactly two read-only Bright Data tools', async (t) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeMcpServer({
    invoke: async () => ({ content: [{ type: 'text', text: 'fixture' }] }),
  });
  const client = new Client({ name: 'bridge-contract-test', version: '0.1.0' });
  t.after(async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const names = listed.tools.map(({ name }) => name).sort();
  assert.deepEqual([...BRIDGE_TOOL_NAMES].sort(), ['scrape_as_markdown', 'search_engine']);
  assert.deepEqual(names, ['scrape_as_markdown', 'search_engine']);
  for (const tool of listed.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
});

test('scrape URLs must resolve only to public HTTPS addresses', async () => {
  assert.equal(
    await assertPublicHttpsUrl('https://example.com/path', { lookup: publicLookup }),
    'https://example.com/path',
  );
  for (const value of [
    'http://example.com/',
    'https://user:password@example.com/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://example.com:8443/',
  ]) {
    await assert.rejects(
      assertPublicHttpsUrl(value, { lookup: publicLookup }),
      (error) => error instanceof BridgeError && error.code === 'INVALID_SCRAPE_URL',
    );
  }
  await assert.rejects(
    assertPublicHttpsUrl('https://public-name.example/', {
      lookup: async () => [{ address: '192.168.1.4', family: 4 }],
    }),
    (error) => error instanceof BridgeError && error.code === 'INVALID_SCRAPE_URL',
  );
});

test('bridge is single-flight and rejects oversized upstream results', async () => {
  const credentialStore = createInMemoryCredentialStore(TEST_TOKEN);
  let release;
  let started;
  const didStart = new Promise((resolve) => {
    started = resolve;
  });
  const invoke = createToolInvoker({
    credentialStore,
    maxResultBytes: 128,
    upstream: async () => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return { content: [] };
    },
  });
  const first = invoke('search_engine', { query: 'first' });
  await didStart;
  await assert.rejects(
    invoke('search_engine', { query: 'second' }),
    (error) => error instanceof BridgeError && error.code === 'BRIDGE_BUSY',
  );
  release();
  await first;

  const oversized = createToolInvoker({
    credentialStore,
    maxResultBytes: 64,
    upstream: async () => ({ content: [{ type: 'text', text: 'x'.repeat(200) }] }),
  });
  await assert.rejects(
    oversized('search_engine', { query: 'large' }),
    (error) => error instanceof BridgeError && error.code === 'RESULT_TOO_LARGE',
  );
});
