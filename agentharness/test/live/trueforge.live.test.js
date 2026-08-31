import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

if (process.env.RUN_TRUEFORGE_LIVE !== '1') {
  throw new Error('RUN_TRUEFORGE_LIVE=1 is required for the opt-in live test');
}

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function eventTypes(result) {
  return new Set(result.trace.map((event) => event.type));
}

async function listSessionEvents(client, trueforgeSessionId) {
  const events = [];
  const page = await client.sessions.listEvents(
    trueforgeSessionId,
    { limit: 100 },
    { timeoutInSeconds: 30, abortSignal: AbortSignal.timeout(30_000) },
  );
  for await (const item of page) events.push(item);
  return events;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toolEvidence(events) {
  const calls = new Map();
  for (const { event } of events) {
    if (event.type !== 'model.message') continue;
    for (const call of event.toolCalls ?? []) calls.set(call.id, call);
  }
  return events
    .filter(({ event }) => event.type === 'tool.response')
    .map(({ event }) => {
      const call = calls.get(event.toolCallId);
      return {
        name: call?.toolInfo?.name,
        arguments: parseJson(call?.function?.arguments ?? ''),
        response: parseJson(typeof event.content === 'string' ? event.content : JSON.stringify(event.content)),
      };
    });
}

test('live TrueForge trace includes MCP, sandbox, approval, effect, and reconnect', { timeout: 600_000 }, async (t) => {
  const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-trueforge-live-'));
  process.env.ALOHALIVE_DATA_DIR = testDataDir;
  const port = Number(process.env.ALOHALIVE_LIVE_PORT ?? 8787);
  let httpServer;
  t.after(async () => {
    if (httpServer?.listening) {
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(testDataDir, { recursive: true, force: true });
  });

  const [{ createServer }, store, { ingestOnce }, trueforge] = await Promise.all([
    import('../../src/server.js'),
    import('../../src/store.js'),
    import('../../src/ingest.js'),
    import('../../src/trueforge.js'),
  ]);
  httpServer = createServer().listen(port, '127.0.0.1');
  await once(httpServer, 'listening');

  store.seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));
  ingestOnce();

  const registered = await trueforge.registerAlohaAgent();
  assert.equal(registered.agent.name, process.env.TRUEFORGE_AGENT_NAME ?? trueforge.DEFAULT_AGENT_NAME);

  const deniedVisitor = store.insert('visitors', { name: 'Denied Demo Visitor', interests: ['diving', 'ocean'] });
  const deniedSession = await trueforge.createAlohaSession({ visitorId: deniedVisitor.id });
  const deniedProposal = await trueforge.runMatchTurn({ sessionId: deniedSession.id });
  const deniedTypes = eventTypes(deniedProposal);
  for (const required of ['mcp.initialize', 'tool.response', 'sandbox.created', 'tool.approval_required']) {
    assert.ok(deniedTypes.has(required), `denied trace includes ${required}`);
  }
  assert.equal(deniedProposal.pendingApprovals.length, 1);
  await trueforge.respondToApproval({
    sessionId: deniedSession.id,
    toolCallId: deniedProposal.pendingApprovals[0].toolCallId,
    decision: 'deny',
    reason: 'live denial assertion',
  });
  assert.equal(store.load('introductions').length, 0);

  const approvedVisitor = store.insert('visitors', { name: 'Approved Demo Visitor', interests: ['diving', 'ocean'] });
  const approvedSession = await trueforge.createAlohaSession({ visitorId: approvedVisitor.id });
  const approvedProposal = await trueforge.runMatchTurn({ sessionId: approvedSession.id });
  assert.equal(approvedProposal.pendingApprovals.length, 1);
  const preApprovalClient = trueforge.createTrueForgeClient();
  const preApprovalEvents = await listSessionEvents(preApprovalClient, approvedSession.trueforgeSessionId);
  assert.ok(
    preApprovalEvents.some(({ event }) => event.type === 'tool.approval_required'),
    'a fresh SDK client restores the persisted pending-approval event',
  );
  assert.equal(
    trueforge.getAlohaSessionState(approvedSession.id).session.pendingApprovals.length,
    1,
    'the local session mapping restores the exact pending approval from disk',
  );
  await trueforge.respondToApproval({
    sessionId: approvedSession.id,
    toolCallId: approvedProposal.pendingApprovals[0].toolCallId,
    decision: 'allow',
  });
  assert.equal(store.load('introductions').length, 1);

  const durableState = trueforge.getAlohaSessionState(approvedSession.id);
  assert.equal(durableState.introductions.length, 1);
  const [durableReceipt] = durableState.introductions;
  assert.equal(durableReceipt.effect, 'demo_introduction_request_record');
  assert.equal(durableReceipt.status, 'pending');
  assert.equal(durableReceipt.visitorId, approvedVisitor.id);
  assert.ok(durableReceipt.id);
  assert.ok(durableReceipt.createdAt);

  const freshClient = trueforge.createTrueForgeClient();
  const turns = await trueforge.listTrueForgeTurns({ sessionId: approvedSession.id, client: freshClient });
  assert.ok(turns.length >= 2, 'a fresh SDK client sees the persisted session turns');
  const events = await listSessionEvents(freshClient, approvedSession.trueforgeSessionId);
  const evidence = toolEvidence(events);
  const sandbox = evidence.find((item) => {
    const result = item.response?.response?.result;
    return item.name === 'exec'
      && item.arguments?.command
      && item.response?.success === true
      && item.response?.response?.exitCode === 0
      && typeof result === 'string'
      && result.includes('ALOHALIVE_SCORE_RECEIPT=');
  });
  assert.ok(sandbox, 'persisted events include a successful sandbox command and score receipt');
  const receiptLine = sandbox.response.response.result.match(/ALOHALIVE_SCORE_RECEIPT=(\{[^\r\n]+\})/);
  assert.ok(receiptLine, 'sandbox output contains a machine-readable score receipt');
  const scoreReceipt = JSON.parse(receiptLine[1]);
  assert.equal(scoreReceipt.agrees, true);
  assert.equal(scoreReceipt.sandboxScore, scoreReceipt.oracleScore);
  assert.equal(scoreReceipt.localId, durableReceipt.localId);
  assert.equal(scoreReceipt.causeId, durableReceipt.causeId);

  const effectEvidence = evidence.find((item) => item.name === 'request_introduction' && item.response?.created === true);
  assert.ok(effectEvidence, 'persisted events include the approved introduction effect response');
  assert.equal(effectEvidence.response.introduction.id, durableReceipt.id);
});
