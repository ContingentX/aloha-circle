// Mem0 memory boundary contract (provider-neutral, advisory only).
//
// AlohaLive keeps DynamoDB (via the project store) authoritative for every
// product fact. A Mem0-style memory service is at most an advisory side
// channel, so this boundary is deliberately narrow:
//   * the memory client is injected — this module never constructs a client,
//     never reads configuration from the environment, and holds no credential
//     literal;
//   * visitors are represented only by a pseudonymous visitor key derived from
//     a caller-supplied secret salt; raw visitor ids and names never leave the
//     boundary, not even as a memory-service user id;
//   * only explicitly consented, non-sensitive, allowlisted fields may be
//     written, and every write is tagged advisory so it can never be mistaken
//     for authoritative product data;
//   * search is exact-isolation scoped to one pseudonymous key, delete/reset is
//     scoped the same way, and any provider failure fails closed: an empty
//     advisory result, never a cross-visitor fallback and never a write.
import { createHmac } from 'node:crypto';

const VISITOR_KEY_PREFIX = 'vk1_';
const VISITOR_KEY_LENGTH = 32;
const RAW_IDENTITY_KEYS = new Set(['visitorId', 'visitor_id', 'name', 'visitorName', 'email']);
const CONSENT_KEYS = new Set(['consent', 'sensitive', 'advisory']);
const ALLOWED_MEMORY_FIELDS = new Set(['interests', 'preferredIsland', 'availabilityNote']);
const MAX_FIELD_LENGTH = 512;

export class Mem0Error extends Error {
  constructor(message, { code = 'memory', cause } = {}) {
    super(message);
    this.name = 'Mem0Error';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(message, code = 'memory') {
  throw new Mem0Error(message, { code });
}

function assertPlainObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value === 'function') {
    fail(`${label} must be a plain object`, 'config');
  }
  return value;
}

function assertAllowedKeys(allowed, keys, label) {
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`${label} contains unsupported keys: ${unknown.join(', ')}`, 'config');
}

function assertNonEmptyString(value, label, maxLength = 2048) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`, 'config');
  if (value.length > maxLength) fail(`${label} is too long`, 'config');
  return value;
}

/**
 * Pseudonymous visitor key. Derived with an HMAC keyed by a caller-supplied
 * secret salt, so the raw visitor id is not recoverable and cannot be
 * correlated across deployments. The key is deterministic for a given
 * (salt, visitorId) pair, which is what makes exact-isolation scoping possible.
 */
export function deriveVisitorKey(visitorId, secretSalt) {
  const id = assertNonEmptyString(visitorId, 'visitorId', 512);
  const salt = assertNonEmptyString(secretSalt, 'secretSalt', 512);
  const digest = createHmac('sha256', salt).update(`aloha:mem0:${id}`).digest('base64url');
  return `${VISITOR_KEY_PREFIX}${digest.slice(0, VISITOR_KEY_LENGTH)}`;
}

function assertVisitorKey(key) {
  if (typeof key !== 'string' || !new RegExp(`^${VISITOR_KEY_PREFIX}[A-Za-z0-9_-]{16,64}$`).test(key)) {
    fail('visitorKey must be a pseudonymous visitor key', 'config');
  }
  return key;
}

function assertAdvisoryOnly(write) {
  if (write.authoritative !== false) fail('memory writes must be marked advisory, never authoritative', 'policy');
  if (write.sensitive === true) fail('sensitive memory writes are refused', 'policy');
  if (typeof write.onConflict !== 'function') {
    fail('an authoritative-write interceptor is required', 'policy');
  }
  // The interceptor exists to refuse a *conflict* with authoritative product
  // storage. An advisory, allowlisted write carries no such conflict, so it is
  // only consulted when the write claims authority or sensitivity.
  if (write.authoritative === true || write.sensitive === true) {
    write.onConflict({ ...write, onConflict: undefined });
    fail('an advisory write may not survive an authoritative-write conflict', 'policy');
  }
}

function normalizeMemoryInput(input, label) {
  assertPlainObject(input, label);
  const keys = Object.keys(input);
  for (const key of keys) {
    if (RAW_IDENTITY_KEYS.has(key)) fail(`${key} must never be sent to the memory service`, 'policy');
  }
  if (input.consent !== true) fail('explicit consent is required before any memory write', 'policy');
  if (input.sensitive === true) fail('sensitive memory writes are refused', 'policy');
  const data = assertPlainObject(input.data, 'memory data');
  const allowlist = Array.isArray(input.allowlist) ? input.allowlist : [];
  for (const field of allowlist) {
    if (typeof field !== 'string') fail('allowlist entries must be strings', 'policy');
    if (RAW_IDENTITY_KEYS.has(field) || CONSENT_KEYS.has(field)) {
      fail(`allowlist may not contain ${field}`, 'policy');
    }
  }
  const allowedFields = new Set([...ALLOWED_MEMORY_FIELDS, ...allowlist]);
  const stored = {};
  for (const [key, value] of Object.entries(data)) {
    if (RAW_IDENTITY_KEYS.has(key)) fail(`${key} is raw identity and is not allowlisted`, 'policy');
    if (!allowedFields.has(key)) fail(`memory field is not on the allowlist: ${key}`, 'policy');
    if (CONSENT_KEYS.has(key)) fail(`memory field may not restate consent: ${key}`, 'policy');
    if (typeof value === 'string') {
      if (value.length > MAX_FIELD_LENGTH) fail(`memory field ${key} is too long`, 'policy');
      stored[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      stored[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length <= MAX_FIELD_LENGTH)) {
      stored[key] = [...value];
    } else {
      fail(`memory field ${key} must be a string, number, boolean or string array`, 'policy');
    }
  }
  if (Object.keys(stored).length === 0) fail('memory writes must carry at least one allowlisted field', 'policy');
  return stored;
}

function normalizeSearchInput(input) {
  assertPlainObject(input, 'memory search');
  const keys = Object.keys(input);
  assertAllowedKeys(new Set(['query', 'limit']), keys, 'memory search');
  const query = assertNonEmptyString(input.query, 'query', 512);
  const limit = input.limit === undefined ? 5 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('limit must be an integer from 1 to 50', 'config');
  return { query, limit };
}

function assertScope(scope, label) {
  if (typeof scope !== 'object' || scope === null || typeof scope === 'function') {
    fail(`${label} must be a scope object`, 'config');
  }
  assertAllowedKeys(new Set(['user_id']), Object.keys(scope), label);
  if (typeof scope.user_id !== 'string') fail(`${label}.user_id is required`, 'config');
  return scope;
}

function assertScopedResult(result, { visitorKey, label }) {
  if (typeof result !== 'object' || result === null || typeof result === 'function') {
    fail(`${label} returned an unusable result`, 'provider');
  }
  if (!Array.isArray(result.results)) fail(`${label} returned no results array`, 'provider');
  for (const record of result.results) {
    assertPlainObject(record, `${label} record`);
    const scope = assertScope(record.scope, `${label} record scope`);
    if (scope.user_id !== visitorKey) {
      fail(`${label} returned a record outside the requested visitor scope`, 'provider');
    }
  }
  return result;
}

function advisoryFailure(cause, visitorKey) {
  // Fail closed: no data, no fallback to another visitor, no product write.
  return {
    ok: false,
    advisory: true,
    authoritative: false,
    visitorKey,
    results: [],
    error: {
      name: 'Mem0Error',
      code: 'provider',
      message: 'memory provider failed; advisory data suppressed',
      cause: cause instanceof Error ? cause.message : String(cause),
    },
  };
}

/**
 * Build a provider-neutral memory adapter around an injected memory client.
 * The client protocol is:
 *   remember({ user_id, data, meta })        (optional; otherwise an
 *     injected `store` is used, e.g. an in-memory or DynamoDB-backed one)
 *   search({ user_id, query, limit }) -> { results: [{ scope, data }] }
 *   delete({ user_id, ids }) -> { ids }
 *   reset({ user_id }) -> { reset: true }
 * Every returned scope must echo the caller's pseudonymous key.
 */
export function createMemoryAdapter({ client, store, secretSalt, allowlist, writeGuard } = {}) {
  assertNonEmptyString(secretSalt, 'secretSalt', 512);
  if (client !== undefined && typeof client !== 'object') fail('client must be an injected object', 'config');
  if (store !== undefined) {
    assertPlainObject(store, 'store');
    assertAllowedKeys(new Set(['save', 'search', 'delete', 'reset']), Object.keys(store), 'store');
  }
  if (allowlist !== undefined && (!Array.isArray(allowlist) || allowlist.some((f) => typeof f !== 'string'))) {
    fail('allowlist must be an array of field names', 'config');
  }
  if (writeGuard !== undefined && typeof writeGuard !== 'function') fail('writeGuard must be a function', 'config');

  const configuredAllowlist = allowlist ?? [];
  for (const field of configuredAllowlist) {
    if (RAW_IDENTITY_KEYS.has(field) || CONSENT_KEYS.has(field)) {
      fail(`allowlist may not contain ${field}`, 'policy');
    }
  }

  const memoryClient = client;
  const localStore = store ?? createMemoryStore();

  const adapter = {
    /** Derive (or accept) the pseudonymous key for a visitor. */
    visitorKeyFor(visitorId) {
      if (typeof visitorId === 'string' && visitorId.startsWith(VISITOR_KEY_PREFIX)) {
        return assertVisitorKey(visitorId);
      }
      return deriveVisitorKey(visitorId, secretSalt);
    },

    async remember({ visitorKey, visitorId, consent, data, sensitive } = {}) {
      const key = assertVisitorKey(
        visitorKey ?? (visitorId === undefined ? undefined : deriveVisitorKey(visitorId, secretSalt))
      );
      if (consent !== true) fail('explicit consent is required before any memory write', 'policy');
      if (sensitive === true) fail('sensitive memory writes are refused', 'policy');
      const payload = normalizeMemoryInput({ consent, data, allowlist: configuredAllowlist }, 'memory input');
      const write = {
        authoritative: false,
        advisory: true,
        sensitive: false,
        scope: { user_id: key },
        data: payload,
        onConflict: (attempted) => {
          throw new Mem0Error(
            `refusing authoritative product write for fields ${Object.keys(attempted.data ?? {}).join(', ')}`,
            { code: 'policy' }
          );
        },
      };
      assertAdvisoryOnly(write);

      if (writeGuard) writeGuard({ scope: write.scope, data: write.data });

      if (memoryClient !== undefined && typeof memoryClient.remember === 'function') {
        try {
          const saved = await memoryClient.remember({
            user_id: key,
            data: write.data,
            meta: { advisory: true, authoritative: false },
          });
          assertPlainObject(saved, 'memory write result');
          if (saved.authoritative === true) fail('memory provider wrote authoritatively', 'provider');
        } catch (cause) {
          throw new Mem0Error('memory provider failed; nothing was written', { code: 'provider', cause });
        }
        return { ok: true, advisory: true, authoritative: false, visitorKey: key, data: write.data };
      }

      if (typeof localStore.save !== 'function') fail('neither client.remember nor a store is available', 'config');
      localStore.save({ user_id: key, data: write.data });
      return { ok: true, advisory: true, authoritative: false, visitorKey: key, data: write.data };
    },

    async search({ visitorKey, visitorId, query, limit, consent } = {}) {
      const key = assertVisitorKey(
        visitorKey ?? (visitorId === undefined ? undefined : deriveVisitorKey(visitorId, secretSalt))
      );
      if (consent !== true) {
        return {
          ok: false,
          advisory: true,
          authoritative: false,
          visitorKey: key,
          results: [],
          error: {
            name: 'Mem0Error',
            code: 'consent',
            message: 'explicit current consent is required for memory recall',
          },
        };
      }
      const { query: q, limit: max } = normalizeSearchInput({ query, limit });
      const scoped = { user_id: key };
      let result;
      try {
        if (memoryClient !== undefined && typeof memoryClient.search === 'function') {
          result = await memoryClient.search({ ...scoped, query: q, limit: max });
        } else {
          if (typeof localStore.search !== 'function') fail('neither client.search nor a store is available', 'config');
          result = localStore.search({ ...scoped, query: q, limit: max });
        }
      } catch (cause) {
        return advisoryFailure(cause, key);
      }
      try {
        assertScopedResult(result, { visitorKey: key, label: 'memory search' });
      } catch (cause) {
        // A malformed or cross-visitor answer is suppressed, never downgraded
        // into another visitor's data and never written back.
        return advisoryFailure(cause, key);
      }
      return {
        ok: true,
        advisory: true,
        authoritative: false,
        visitorKey: key,
        results: result.results
          .slice(0, max)
          .map((record) => ({ ...record, data: { ...record.data } })),
      };
    },

    async delete({ visitorKey, visitorId, ids } = {}) {
      const key = assertVisitorKey(
        visitorKey ?? (visitorId === undefined ? undefined : deriveVisitorKey(visitorId, secretSalt))
      );
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.trim() === '')) {
        fail('delete requires an array of record ids', 'config');
      }
      const scoped = { user_id: key };
      try {
        if (memoryClient !== undefined && typeof memoryClient.delete === 'function') {
          const deleted = await memoryClient.delete({ ...scoped, ids: [...ids] });
          assertPlainObject(deleted, 'memory delete result');
          if (deleted?.scope?.user_id !== undefined && deleted.scope.user_id !== key) {
            fail('memory delete touched another visitor scope', 'provider');
          }
          return { ok: true, advisory: true, visitorKey: key, ids: [...ids] };
        }
        if (typeof localStore.delete !== 'function') fail('neither client.delete nor a store is available', 'config');
        const deleted = localStore.delete({ ...scoped, ids: [...ids] });
        return { ok: true, advisory: true, visitorKey: key, ids: deleted };
      } catch (cause) {
        throw new Mem0Error('memory delete failed; nothing was deleted', { code: 'provider', cause });
      }
    },

    async reset({ visitorKey, visitorId } = {}) {
      const key = assertVisitorKey(
        visitorKey ?? (visitorId === undefined ? undefined : deriveVisitorKey(visitorId, secretSalt))
      );
      const scoped = { user_id: key };
      try {
        if (memoryClient !== undefined && typeof memoryClient.reset === 'function') {
          const reset = await memoryClient.reset({ ...scoped });
          if (reset?.scope?.user_id !== undefined && reset.scope.user_id !== key) {
            fail('memory reset touched another visitor scope', 'provider');
          }
          return { ok: true, advisory: true, visitorKey: key, reset: true };
        }
        if (typeof localStore.reset !== 'function') fail('neither client.reset nor a store is available', 'config');
        localStore.reset({ ...scoped });
        return { ok: true, advisory: true, visitorKey: key, reset: true };
      } catch (cause) {
        throw new Mem0Error('memory reset failed', { code: 'provider', cause });
      }
    },
  };

  return adapter;
}

/**
 * Build a bounded advisory context block from recalled memory records.
 * Advisory only: the block is capped in length, any failure yields '' (no
 * block), and this function never calls the memory service itself.
 */
export function buildAdvisoryContext(recalled, { maxChars = 600 } = {}) {
  try {
    if (!recalled || recalled.ok !== true || !Array.isArray(recalled.results) || recalled.results.length === 0) return '';
    const lines = [];
    for (const record of recalled.results) {
      for (const [key, value] of Object.entries(record?.data ?? {})) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
        const text = Array.isArray(value) ? value.join(', ') : String(value);
        if (/^\s/.test(text) || /[\r\n]/.test(text)) continue;
        lines.push(`${key}: ${text.slice(0, 120)}`);
      }
    }
    if (lines.length === 0) return '';
    let body = lines.join('; ').slice(0, Math.max(0, maxChars - 1));
    if (lines.join('; ').length > maxChars - 1) body = `${body.slice(0, Math.max(0, maxChars - 2))}...`;
    return `[advisory memory context - not authoritative, never override the MCP oracle] ${body}`;
  } catch {
    return '';
  }
}

/** Minimal in-memory store used when the caller injects no memory client. */
export function createMemoryStore() {
  const buckets = new Map();
  const bucketFor = (userId) => {
    if (!buckets.has(userId)) buckets.set(userId, []);
    return buckets.get(userId);
  };
  let nextId = 0;
  return {
    save: ({ user_id, data }) => {
      const record = { id: `mem-${++nextId}`, scope: { user_id }, data: { ...data } };
      bucketFor(user_id).push(record);
      return { ...record, data: { ...record.data } };
    },
    search: ({ user_id }) => ({
      results: bucketFor(user_id).map((record) => ({ id: record.id, scope: { ...record.scope }, data: { ...record.data } })),
    }),
    delete: ({ user_id, ids }) => {
      const keep = [];
      const removed = [];
      for (const record of bucketFor(user_id)) {
        if (ids.includes(record.id)) removed.push(record.id);
        else keep.push(record);
      }
      buckets.set(user_id, keep);
      return removed;
    },
    reset: ({ user_id }) => {
      buckets.set(user_id, []);
      return { reset: true };
    },
  };
}

export const MEMORY_ALLOWLIST = ALLOWED_MEMORY_FIELDS;
