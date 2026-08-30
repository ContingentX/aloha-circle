// Maui Needs Index ingest loop.
// Reads version-controlled scraper settings from sources.json, extracts
// CauseSignals, validates them against each source's schema contract, and
// flags sources whose output shape broke as needs_repair — the seam where
// Bright Data's scraper auto-repair plugs in (phase 2).
//
// The brightdata parser is a pure seam: the caller must inject both a
// `brightdata` adapter factory (see src/brightdata.js) and a per-source
// `sources` entry. Nothing here reads the environment, opens a socket, or
// holds a credential. If an enabled brightdata source has no injected
// adapter, only that source is marked needs_repair and fixtures keep running.
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
  brightdata(source, { brightdata, brightdataSources } = {}) {
    const sourceConfig = brightdataSources?.[source.id];
    if (typeof brightdata !== 'function' || !sourceConfig) {
      // Fail closed for this source only: no injected adapter/config means no
      // provider call may happen; other sources continue.
      throw new Error('brightdata adapter and source config must be injected by the caller');
    }
    const adapter = brightdata({
      provider: { name: 'brightdata' },
      transport: sourceConfig.transport,
      config: sourceConfig.config,
      source: { id: source.id, url: sourceConfig.url ?? source.url, schema: source.schema },
    });
    return adapter.fetchCauseSignals().then((result) => result.signals);
  },
};

function validate(record, schema) {
  const missing = schema.required.filter((f) => record[f] === undefined || record[f] === null);
  return { ok: missing.length === 0, missing };
}

export async function ingestOnce(options = {}) {
  const { sources } = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'sources.json'), 'utf8'));
  const status = [];

  for (const source of sources) {
    if (!source.enabled) {
      status.push({ id: source.id, state: 'disabled' });
      continue;
    }
    try {
      const records = await parsers[source.parser](source, options);
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
        // Preserve adapter-supplied provenance (sourceUrl, fetchedAt) exactly;
        // never overwrite it with a local clock. Fixture records stay
        // fixture-derived: they carry no fetchedAt, so the ingest run stamps
        // them, exactly as before.
        upsert('causes', { field: 'title', value: r.title }, {
          ...r,
          source: source.id,
          ...(r.fetchedAt === undefined ? { fetchedAt: new Date().toISOString() } : {}),
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

export function startIngestLoop(intervalMs, options = {}) {
  const run = async () => {
    const { status, totalCauses } = await ingestOnce(options);
    const repairs = status.filter((s) => s.state === 'needs_repair');
    console.log(
      `[ingest] ${new Date().toISOString()} causes=${totalCauses} ok=${status.filter((s) => s.state === 'ok').length} needs_repair=${repairs.length}` +
        (repairs.length ? ` (${repairs.map((r) => r.id).join(', ')})` : '')
    );
  };
  void run();
  return setInterval(() => void run(), intervalMs);
}
