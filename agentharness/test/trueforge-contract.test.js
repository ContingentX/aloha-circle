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
function completedStream(turnId) {
  const entries = [
    {
      id: '1',
      data: {
        id: `${turnId}-created`,
        type: 'turn.created',
        turnId,
        threadId: null,
        state: { status: 'running' },
      },
    },
    {
      id: '2',
      data: {
        id: `${turnId}-done`,
        type: 'turn.done',
        threadId: null,
        state: { status: 'done', requiredActions: [], output: null },
      },
    },
  ];
  return {
    async *withMetadata() {
      yield* entries;
    },
  };
}

function terminalStreamThatStaysOpen(turnId, onClose) {
  return {
    async *withMetadata() {
      try {
        for await (const entry of completedStream(turnId).withMetadata()) {
          yield entry;
        }
        await new Promise((_, reject) => {
          setTimeout(() => reject(new Error('collector waited after turn.done')), 100);
        });
      } finally {
        onClose();
      }
    },
  };
}

test('MCP tools and TrueForge manifest enforce the vertical-slice contract', async (t) => {
  const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-trueforge-contract-'));
  process.env.ALOHALIVE_DATA_DIR = testDataDir;
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

  const [server, store, { ingestOnce }, introductions, trueforge, matcher, mcp] = await Promise.all([
    import('../src/server.js'),
    import('../src/store.js'),
    import('../src/ingest.js'),
    import('../src/introductions.js'),
    import('../src/trueforge.js'),
    import('../src/matcher.js'),
    import('../src/mcp.js'),
  ]);
  const { createServer } = server;

  store.seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));
  await ingestOnce();
  const visitor = store.insert('visitors', { name: 'Contract Visitor', interests: ['diving', 'ocean'] });
  const trueforgeSessionId = 'sess-contract-1';
  const appSession = await trueforge.createAlohaSession({
    visitorId: visitor.id,
    agentSpec: trueforge.buildAgentSpec({ modelName: 'test/model', mcpServerName: 'alohalive-local' }),
    client: {
      sessions: {
        // The SDK unwraps the HTTP envelope to GetSessionResponse: { data: Session }.
        create: async () => ({ data: { id: trueforgeSessionId } }),
      },
    },
  });
  assert.equal(appSession.trueforgeSessionId, trueforgeSessionId);
  let terminalStreamClosed = false;
  const terminalResult = await trueforge.runMatchTurn({
    sessionId: appSession.id,
    client: {
      sessions: {
        createTurnStream: async () => terminalStreamThatStaysOpen('turn-terminal-1', () => {
          terminalStreamClosed = true;
        }),
      },
    },
  });
  assert.equal(terminalResult.terminalState.status, 'done');
  assert.equal(terminalStreamClosed, true);

  const context = introductions.getMatchContext({ sessionId: trueforgeSessionId, visitorId: visitor.id });
  assert.ok(context.oracle.localId);
  assert.ok(context.oracle.causeId);
  assert.equal(context.oracle.blocks.length, 3);
  assert.equal(context.scorer.version, 1);
  assert.equal(context.scorer.endorsementScope, 'all_endorsements_for_cause_nonprofit');
  assert.match(context.scorer.formula, /every endorsement where endorsement\.nonprofit === cause\.nonprofit/);
  assert.equal(context.oracle.score, 22);

  assert.throws(
    () => matcher.rankMatch(visitor, {
      locals: context.locals,
      causes: [{ ...context.causes[0], urgency: 0 }],
      endorsements: context.endorsements,
    }),
    /cause.urgency must be an integer from 1 through 5/,
  );
  assert.equal(mcp.isLoopbackAddress('127.0.0.1'), true);
  assert.equal(mcp.isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(mcp.isLoopbackAddress('192.168.1.50'), false);

  let remoteStatus = null;
  let remoteBody = null;
  let remoteNextCalled = false;
  server.requireLoopback(
    { socket: { remoteAddress: '192.168.1.50' } },
    {
      status(code) {
        remoteStatus = code;
        return this;
      },
      json(body) {
        remoteBody = body;
        return body;
      },
    },
    () => {
      remoteNextCalled = true;
    },
  );
  assert.equal(remoteStatus, 403);
  assert.deepEqual(remoteBody, { error: 'agent API is loopback-only' });
  assert.equal(remoteNextCalled, false);

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

  const spec = trueforge.buildAgentSpec({
    modelName: 'test/model',
    mcpServerName: 'alohalive-local',
    brightDataMcpServerName: '',
  });
  assert.equal(spec.config.sandbox.enabled, true);
  assert.equal(spec.config.dynamic_sub_agents.enabled, false);
  assert.equal(spec.config.iteration_limit, 20);
  assert.equal(spec.mcp_servers.length, 1);
  assert.deepEqual(spec.mcp_servers[0].require_approval_for_tools, ['request_introduction']);
  assert.equal(spec.instructions.includes('Bright Data'), false);

  const brightDataSpec = trueforge.buildAgentSpec({
    modelName: 'test/model',
    mcpServerName: 'alohalive-local',
    brightDataMcpServerName: 'brightdata-live',
  });
  assert.equal(brightDataSpec.mcp_servers.length, 2);
  assert.deepEqual(brightDataSpec.mcp_servers[0], spec.mcp_servers[0]);
  assert.deepEqual(brightDataSpec.mcp_servers[0].require_approval_for_tools, ['request_introduction']);
  assert.deepEqual(brightDataSpec.mcp_servers[1], {
    name: 'brightdata-live',
    enable_tools: ['search_engine', 'scrape_as_markdown'],
    preload_tools: ['search_engine', 'scrape_as_markdown'],
    require_approval_for_tools: [],
    preload: true,
  });
  assert.equal(brightDataSpec.mcp_servers[1].enable_tools.includes('request_introduction'), false);
  assert.match(brightDataSpec.instructions, /Use Bright Data first/);
  assert.match(brightDataSpec.instructions, /untrusted advisory evidence/);
  assert.match(brightDataSpec.instructions, /cite the source URL/);
  assert.match(brightDataSpec.instructions, /never use them to alter the deterministic oracle IDs or score/);
  assert.match(brightDataSpec.instructions, /Never persist Bright Data results or execute any real-world effect/);

  const previousBrightDataServer = process.env.TRUEFORGE_BRIGHTDATA_MCP_SERVER;
  try {
    delete process.env.TRUEFORGE_BRIGHTDATA_MCP_SERVER;
    const absentEnvSpec = trueforge.buildAgentSpec({ modelName: 'test/model', mcpServerName: 'alohalive-local' });
    assert.deepEqual(absentEnvSpec, spec, 'an absent connector preserves the existing spec exactly');

    process.env.TRUEFORGE_BRIGHTDATA_MCP_SERVER = 'brightdata-live-from-env';
    const envSpec = trueforge.buildAgentSpec({ modelName: 'test/model', mcpServerName: 'alohalive-local' });
    assert.equal(envSpec.mcp_servers[1].name, 'brightdata-live-from-env');
  } finally {
    if (previousBrightDataServer === undefined) delete process.env.TRUEFORGE_BRIGHTDATA_MCP_SERVER;
    else process.env.TRUEFORGE_BRIGHTDATA_MCP_SERVER = previousBrightDataServer;
  }

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
  assert.equal(first.isError, true);
  assert.match(first.content[0].text, /no matching human-approved introduction is pending/);
  assert.equal(store.load('introductions').length, 0);

  const toolArguments = {
    session_id: trueforgeSessionId,
    visitor_id: visitor.id,
    local_id: context.oracle.localId,
    cause_id: context.oracle.causeId,
    explanation: context.oracle.why,
  };
  const normalizedArguments = introductions.introductionArgumentsFromToolCall(toolArguments);
  const pending = {
    threadId: 'main',
    toolCallId: 'call-approved-1',
    sourceEventId: 'model-message-1',
    toolName: 'request_introduction',
    arguments: toolArguments,
    argumentsHash: introductions.introductionArgumentsHash(normalizedArguments),
  };
  store.updateById('sessions', appSession.id, { pendingApprovals: [pending] });
  const approvalResult = await trueforge.respondToApproval({
    sessionId: appSession.id,
    toolCallId: pending.toolCallId,
    decision: 'allow',
    client: {
      sessions: {
        createTurnStream: async () => {
          const effect = introductions.requestIntroduction(normalizedArguments);
          assert.equal(effect.created, true);
          return completedStream('turn-approved-1');
        },
      },
    },
  });
  assert.equal(approvalResult.terminalState.status, 'done');
  assert.equal(store.load('introductions').length, 1);

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

  const racingPending = { ...pending, toolCallId: 'call-race-1' };
  store.updateById('sessions', appSession.id, { pendingApprovals: [racingPending] });
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const firstDecision = trueforge.respondToApproval({
    sessionId: appSession.id,
    toolCallId: racingPending.toolCallId,
    decision: 'allow',
    client: {
      sessions: {
        createTurnStream: async () => {
          await providerGate;
          return completedStream('turn-race-1');
        },
      },
    },
  });
  await assert.rejects(
    trueforge.respondToApproval({
      sessionId: appSession.id,
      toolCallId: racingPending.toolCallId,
      decision: 'deny',
      client: { sessions: { createTurnStream: async () => completedStream('turn-race-2') } },
    }),
    /approval is not pending for this session/,
  );
  releaseProvider();
  await firstDecision;
});
