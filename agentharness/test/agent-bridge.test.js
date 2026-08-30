import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('visitor submission starts a visible TrueForge run', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-agent-bridge-'));
  process.env.ALOHALIVE_DATA_DIR = dataDir;
  const [{ createServer }, store] = await Promise.all([
    import('../src/server.js'),
    import('../src/store.js'),
  ]);
  store.insert('locals', { name: 'Keoni', town: 'Lahaina', interests: ['ocean'], causes: ['reef'] });
  store.insert('causes', {
    title: 'Saturday reef cleanup', summary: 'Restore a local reef.', nonprofit: 'Reef Friends',
    causeTags: ['ocean', 'reef'], urgency: 5, action: 'Join Saturday morning.',
  });

  const createSession = async ({ visitorId }) => store.insert('sessions', {
    visitorId,
    trueforgeSessionId: 'tf-test-1',
    trueforgeAgentName: 'alohalive-maui-match',
    status: 'ready',
    pendingApprovals: [],
  });
  const runTurn = async ({ sessionId }) => {
    const pendingApprovals = [{ toolCallId: 'tool-1', toolName: 'request_introduction' }];
    const trace = [{ sequenceNumber: 1, type: 'tool.approval_required' }];
    store.updateById('sessions', sessionId, { status: 'paused', pendingApprovals, lastTrace: trace });
    return { terminalState: { status: 'paused' }, pendingApprovals, trace };
  };
  let registrations = 0;
  const registerAgent = async () => {
    registrations += 1;
    return { agent: { id: 'agent-test-1', name: 'alohalive-maui-match' }, action: 'updated' };
  };
  const server = createServer({ createSession, runTurn, registerAgent }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const runResponse = await fetch(`${base}/api/agent/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Strong Demo', interests: ['ocean'] }),
  });
  assert.equal(runResponse.status, 202);
  const run = await runResponse.json();
  assert.equal(run.match.localName, 'Keoni');
  assert.equal(run.agent.name, 'alohalive-maui-match');
  assert.equal(run.agent.binding, 'named');
  assert.equal(run.agent.trueforgeSessionId, 'tf-test-1');
  assert.equal(run.agent.status, 'running');
  assert.equal(run.agent.pendingApprovals.length, 0);
  assert.equal(registrations, 1);

  await new Promise((resolve) => setImmediate(resolve));

  const config = await (await fetch(`${base}/api/agent/config`)).json();
  assert.deepEqual(config, { agentName: 'alohalive-maui-match', binding: 'named' });

  const crossOrigin = await fetch(`${base}/api/agent/config`, {
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(crossOrigin.status, 403);

  const sessions = await (await fetch(`${base}/api/agent/sessions`)).json();
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].visitor.name, 'Strong Demo');
  assert.equal(sessions.sessions[0].session.lastTrace[0].type, 'tool.approval_required');

  const consoleResponse = await fetch(`${base}/agent-console`);
  assert.equal(consoleResponse.status, 200);
  assert.match(await consoleResponse.text(), /TrueForge operator view/);
});

test('Dynamo bridge preserves authoritative IDs for the TrueForge MCP context', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-dynamo-bridge-'));
  process.env.ALOHALIVE_DATA_DIR = dataDir;
  t.after(() => {
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });
  const [{ createAgentVisitorAndMatch }, store, introductions] = await Promise.all([
    import('../src/server.js'),
    import('../src/store.js'),
    import('../src/introductions.js'),
  ]);
  const visitorId = 'e944b4f7-53bc-4484-96b2-84ea26a9499c';
  const created = await createAgentVisitorAndMatch(
    { name: 'Dynamo Kai', interests: ['ocean'] },
    {
      publicApiClient: {
        createVisitorAndMatch: async () => ({
          visitor: { id: visitorId, name: 'Dynamo Kai', interests: ['ocean'] },
          match: {
            id: '4303c0b5-d13f-41d5-b96f-1320bc9deaa4',
            visitorId,
            localId: 'keoni',
            localName: 'Keoni',
            localTown: 'Lahaina',
            causeId: 'reef-restoration',
            cause: 'Restore the reef',
            score: 12,
            scoreReceipt: { total: 12 },
            blocks: [
              { type: 'local', id: 'keoni', name: 'Keoni', town: 'Lahaina' },
              { type: 'cause', id: 'reef-restoration', title: 'Restore the reef' },
              { type: 'action', text: 'Join the cleanup.' },
            ],
          },
        }),
      },
    },
  );
  assert.equal(created.dataSource, 'dynamo-public-api');
  assert.equal(created.visitor.id, visitorId);
  assert.equal(created.match.localId, 'keoni');
  assert.equal(created.match.causeId, 'reef-restoration');

  store.insert('sessions', {
    visitorId,
    trueforgeSessionId: 'tf-dynamo-1',
    trueforgeAgentName: 'alohalive-maui-match',
    contextSource: created.dataSource,
  });
  const context = introductions.getMatchContext({ sessionId: 'tf-dynamo-1', visitorId });
  assert.equal(context.authoritativeSource, 'dynamo-public-api');
  assert.equal(context.oracle.localId, 'keoni');
  assert.equal(context.oracle.causeId, 'reef-restoration');
  assert.equal(context.oracle.scoreReceipt.total, context.oracle.score);
});
