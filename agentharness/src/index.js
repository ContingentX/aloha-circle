import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import { startIngestLoop, ingestOnce } from './ingest.js';
import { seedIfEmpty } from './store.js';

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Provider credentials live in agentharness/.env (never committed, see
// CLAUDE.md). Minimal loader: KEY=VALUE lines, no override of real env.
try {
  for (const line of fs.readFileSync(path.join(HARNESS_DIR, '.env'), 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch { /* no .env file — env vars only */ }

const PORT = process.env.PORT ?? 8787;
const HOST = process.env.ALOHALIVE_HOST ?? '127.0.0.1';
const INGEST_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS ?? 5 * 60 * 1000);
const INGEST_OPTIONS = { octen: { apiKey: process.env.OCTEN_API_KEY } };

if (seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'))) {
  console.log('[seed] loaded seed locals, nonprofits and endorsements');
}

if (process.argv.includes('--ingest-once')) {
  console.log(JSON.stringify(await ingestOnce(INGEST_OPTIONS), null, 2));
  // No process.exit(): a hard exit races undici's live-fetch sockets and
  // crashes libuv on Windows. Nothing else keeps the loop alive here.
  process.exitCode = 0;
} else {
  startIngestLoop(INGEST_INTERVAL_MS, INGEST_OPTIONS);
  createServer().listen(PORT, HOST, () => {
    console.log(`[aloha-agentharness] API on http://${HOST}:${PORT} (ingest every ${INGEST_INTERVAL_MS / 1000}s)`);
  });
}
