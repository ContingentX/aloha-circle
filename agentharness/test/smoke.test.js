// End-to-end smoke test: seed → ingest → visitor signup → match.
// Runs against the real data dir (gitignored); cause upserts are idempotent.
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from '../src/store.js';
import { ingestOnce } from '../src/ingest.js';
import { createServer } from '../src/server.js';

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'));

const { status } = ingestOnce();
assert.ok(status.some((s) => s.state === 'ok'), 'at least one source ingests ok');
assert.ok(status.some((s) => s.state === 'needs_repair'), 'broken demo source is flagged needs_repair');

const server = createServer().listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
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
  server.close();
});
