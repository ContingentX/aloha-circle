import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-trueforge-contract-'));
process.env.ALOHALIVE_DATA_DIR = testDataDir;

const [{ createServer }, store, { ingestOnce }, introductions, trueforge] = await Promise.all([
  import('../src/server.js'),
  import('../src/store.js'),
  import('../src/ingest.js'),
  import('../src/introductions.js'),
  import('../src/trueforge.js'),
]);

test('MCP tools and TrueForge manifest enforce the vertical-slice contract', async (t) => {
  let httpServer;
  let mcpClient;
  t.after(async () => {
    await mcpClient?.close();
    if (httpServer?.listening) {
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(testDataDir, { recursive: true, force: true });
  });

  store.seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));
  ingestOnce();
  const visitor = store.insert('visitors', { name: 'Contract Visitor', interests: ['diving', 'ocean'] });
  const trueforgeSessionId = 'sess-contract-1';
  const appSession = await trueforge.createAlohaSession({
    visitorId: visitor.id,
    agentSpec: trueforge.buildAgentSpec({ modelName: 'test/model', mcpServerName: 'alohalive-local' }),
    client: {
      sessions: {
        // The SDK promise unwraps directly to the parsed session, not { data }.
        create: async () => ({ id: trueforgeSessionId }),
      },
    },
  });
  assert.equal(appSession.trueforgeSessionId, trueforgeSessionId);

  const context = introductions.getMatchContext({ sessionId: trueforgeSessionId, visitorId: visitor.id });
  assert.ok(context.oracle.localId);
  assert.ok(context.oracle.causeId);
  assert.equal(context.oracle.blocks.length, 3);

  assert.throws(
    () => introductions.requestIntroduction({
      sessionId: trueforgeSessionId,
      visitorId: visitor.id,
      localId: crypto.randomUUID(),
      causeId: context.oracle.causeId,
      explanation: 'wrong local',
    }),
    /does not match the deterministic scoring oracle/,
  );

  const spec = trueforge.buildAgentSpec({ modelName: 'test/model', mcpServerName: 'alohalive-local' });
  assert.equal(spec.config.sandbox.enabled, true);
  assert.equal(spec.config.dynamic_sub_agents.enabled, false);
  assert.equal(spec.config.iteration_limit, 20);
  assert.deepEqual(spec.mcp_servers[0].require_approval_for_tools, ['request_introduction']);

  httpServer = createServer().listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpServer.address().port}/mcp`));
  mcpClient = new Client({ name: 'alohalive-contract-test', version: '0.1.0' });
  await mcpClient.connect(transport);

  const tools = await mcpClient.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['get_match_context', 'request_introduction']);
  assert.equal(tools.tools.find((tool) => tool.name === 'get_match_context').annotations.readOnlyHint, true);
  assert.equal(tools.tools.find((tool) => tool.name === 'request_introduction').annotations.readOnlyHint, false);

  const read = await mcpClient.callTool({
    name: 'get_match_context',
    arguments: { session_id: trueforgeSessionId, visitor_id: visitor.id },
  });
  assert.equal(read.isError, undefined);
  const mcpContext = JSON.parse(read.content[0].text);
  assert.equal(mcpContext.oracle.localId, context.oracle.localId);

  const first = await mcpClient.callTool({
    name: 'request_introduction',
    arguments: {
      session_id: trueforgeSessionId,
      visitor_id: visitor.id,
      local_id: context.oracle.localId,
      cause_id: context.oracle.causeId,
      explanation: context.oracle.why,
    },
  });
  assert.equal(JSON.parse(first.content[0].text).created, true);

  const replay = await mcpClient.callTool({
    name: 'request_introduction',
    arguments: {
      session_id: trueforgeSessionId,
      visitor_id: visitor.id,
      local_id: context.oracle.localId,
      cause_id: context.oracle.causeId,
      explanation: context.oracle.why,
    },
  });
  assert.equal(JSON.parse(replay.content[0].text).created, false);
  assert.equal(store.load('introductions').length, 1);
});
