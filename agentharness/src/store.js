// JSON-file store. One file per collection under agentharness/data/.
// Swappable for a real DB later without touching the API or matcher.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const COLLECTIONS = [
  'visitors',
  'locals',
  'nonprofits',
  'causes',
  'endorsements',
  'matches',
  'sessions',
  'introductions',
];

export function getDataDir() {
  return process.env.ALOHALIVE_DATA_DIR
    ? path.resolve(process.env.ALOHALIVE_DATA_DIR)
    : DEFAULT_DATA_DIR;
}

function file(collection) {
  return path.join(getDataDir(), `${collection}.json`);
}

export function load(collection) {
  try {
    return JSON.parse(fs.readFileSync(file(collection), 'utf8'));
  } catch {
    return [];
  }
}

export function save(collection, records) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(file(collection), JSON.stringify(records, null, 2));
  return records;
}

export function insert(collection, record) {
  const records = load(collection);
  const withId = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...record };
  records.push(withId);
  save(collection, records);
  return withId;
}

export function findById(collection, id) {
  return load(collection).find((record) => record.id === id) ?? null;
}

export function updateById(collection, id, patch) {
  const records = load(collection);
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return null;
  records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
  save(collection, records);
  return records[index];
}

// Upsert keyed by a natural key (used by ingest so re-scrapes don't duplicate causes).
export function upsert(collection, key, record) {
  const records = load(collection);
  const idx = records.findIndex((r) => r[key.field] === key.value);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...record, updatedAt: new Date().toISOString() };
    save(collection, records);
    return records[idx];
  }
  return insert(collection, record);
}

export function counts() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, load(c).length]));
}

// Seed locals/nonprofits once so a fresh visitor signup gets an instant match.
export function seedIfEmpty(seedPath) {
  if (load('locals').length > 0 || load('nonprofits').length > 0) return false;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  for (const local of seed.locals) insert('locals', local);
  for (const np of seed.nonprofits) insert('nonprofits', np);
  for (const e of seed.endorsements) insert('endorsements', e);
  return true;
}
