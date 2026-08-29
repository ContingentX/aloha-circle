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
const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-trueforge-live-'));
process.env.ALOHALIVE_DATA_DIR = testDataDir;

const [{ createServer }, store, { ingestOnce }, trueforge] = await Promise.all([
  import('../../src/server.js'),
  import('../../src/store.js'),
  import('../../src/ingest.js'),
  import('../../src/trueforge.js'),
]);

function eventTypes(result) {
  return new Set(result.trace.map((event) => event.type));
}

test('live TrueForge trace includes MCP, sandbox, approval, effect, and reconnect', { timeout: 600_000 }, async (t) => {
  const port = Number(process.env.ALOHALIVE_LIVE_PORT ?? 8787);
  const httpServer = createServer().listen(port, '127.0.0.1');
  await once(httpServer, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(testDataDir, { recursive: true, force: true });
  });

  store.seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));
  ingestOnce();

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
  await trueforge.respondToApproval({
    sessionId: approvedSession.id,
    toolCallId: approvedProposal.pendingApprovals[0].toolCallId,
    decision: 'allow',
  });
  assert.equal(store.load('introductions').length, 1);

  const freshClient = trueforge.createTrueForgeClient();
  const turns = await trueforge.listTrueForgeTurns({ sessionId: approvedSession.id, client: freshClient });
  assert.ok(turns.length >= 2, 'a fresh SDK client sees the persisted session turns');
});
