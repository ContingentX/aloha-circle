// Maui Needs Index ingest loop.
// Reads version-controlled scraper settings from sources.json, extracts
// CauseSignals, validates them against each source's schema contract, and
// flags sources whose output shape broke as needs_repair — the seam where
// Bright Data's scraper auto-repair plugs in (phase 2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsert, load, getDataDir } from './store.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = path.join(SRC_DIR, '..');

const parsers = {
  fixture(source) {
    const raw = fs.readFileSync(path.join(HARNESS_DIR, source.url), 'utf8');
    return JSON.parse(raw);
  },
  brightdata() {
    throw new Error('Bright Data parser lands in phase 2 (see PLANFILE.md)');
  },
};

function validate(record, schema) {
  const missing = schema.required.filter((f) => record[f] === undefined || record[f] === null);
  return { ok: missing.length === 0, missing };
}

export function ingestOnce() {
  const { sources } = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'sources.json'), 'utf8'));
  const status = [];

  for (const source of sources) {
    if (!source.enabled) {
      status.push({ id: source.id, state: 'disabled' });
      continue;
    }
    try {
      const records = parsers[source.parser](source);
      const bad = records.map((r) => validate(r, source.schema)).filter((v) => !v.ok);
      if (bad.length > 0) {
        // Shape broke: the site (or fixture) no longer matches the contract.
        status.push({
          id: source.id,
          state: 'needs_repair',
          detail: `${bad.length}/${records.length} records failed schema: missing ${[...new Set(bad.flatMap((b) => b.missing))].join(', ')}`,
        });
        continue;
      }
      for (const r of records) {
        upsert('causes', { field: 'title', value: r.title }, {
          ...r,
          source: source.id,
          fetchedAt: new Date().toISOString(),
        });
      }
      status.push({ id: source.id, state: 'ok', ingested: records.length });
    } catch (err) {
      status.push({ id: source.id, state: 'needs_repair', detail: err.message });
    }
  }

  const statusFile = path.join(getDataDir(), 'sources.status.json');
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify({ ranAt: new Date().toISOString(), status }, null, 2));
  return { status, totalCauses: load('causes').length };
}

export function startIngestLoop(intervalMs) {
  const run = () => {
    const { status, totalCauses } = ingestOnce();
    const repairs = status.filter((s) => s.state === 'needs_repair');
    console.log(
      `[ingest] ${new Date().toISOString()} causes=${totalCauses} ok=${status.filter((s) => s.state === 'ok').length} needs_repair=${repairs.length}` +
        (repairs.length ? ` (${repairs.map((r) => r.id).join(', ')})` : '')
    );
  };
  run();
  return setInterval(run, intervalMs);
}
