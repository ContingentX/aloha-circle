import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import { startIngestLoop, ingestOnce } from './ingest.js';
import { seedIfEmpty } from './store.js';

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT ?? 8787;
const HOST = process.env.ALOHALIVE_HOST ?? '127.0.0.1';
const INGEST_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS ?? 5 * 60 * 1000);

if (seedIfEmpty(path.join(HARNESS_DIR, 'fixtures', 'seed.json'))) {
  console.log('[seed] loaded seed locals, nonprofits and endorsements');
}

if (process.argv.includes('--ingest-once')) {
  console.log(JSON.stringify(await ingestOnce(), null, 2));
  process.exit(0);
}

startIngestLoop(INGEST_INTERVAL_MS);
createServer().listen(PORT, HOST, () => {
  console.log(`[aloha-agentharness] API on http://${HOST}:${PORT} (ingest every ${INGEST_INTERVAL_MS / 1000}s)`);
});
