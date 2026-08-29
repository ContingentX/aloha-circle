// End-to-end smoke test: seed → ingest → visitor signup → match.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('seed → ingest → visitor signup → match', async (t) => {
  const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'alohalive-harness-test-'));
  process.env.ALOHALIVE_DATA_DIR = testDataDir;
  let server;
  t.after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    delete process.env.ALOHALIVE_DATA_DIR;
    rmSync(testDataDir, { recursive: true, force: true });
  });

  const [{ seedIfEmpty }, { ingestOnce }, { createServer }] = await Promise.all([
    import('../src/store.js'),
    import('../src/ingest.js'),
    import('../src/server.js'),
  ]);

  seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));
  const { status } = ingestOnce();
  assert.ok(status.some((s) => s.state === 'ok'), 'at least one source ingests ok');
  assert.ok(status.some((s) => s.state === 'needs_repair'), 'broken demo source is flagged needs_repair');

  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);

  const res = await fetch(`${base}/api/visitors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Test Visitor', interests: ['diving', 'ocean'] }),
  });
  assert.equal(res.status, 201);
  const { match } = await res.json();
  assert.ok(match, 'visitor gets a match');
  assert.ok(match.localName, 'match names a local');
  assert.ok(match.cause, 'match names a cause');
  console.log('SMOKE OK —', `${match.visitorName} ↔ ${match.localName} (${match.localTown}) / ${match.cause}`);
});
