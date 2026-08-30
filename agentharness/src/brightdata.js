// Bright Data adapter boundary contract (provider-neutral, offline by construction).
//
// AlohaLive treats Bright Data as one interchangeable scraping provider among
// many. This module owns the *boundary* only:
//   * every transport, credential and configuration value is injected by the
//     caller — this file never contains a credential literal, never reads the
//     process environment, and never opens a socket of its own;
//   * provider payloads are normalised into the project CauseSignal shape and
//     must carry full provenance (source URL + fetched timestamp) before they
//     are allowed anywhere near the store;
//   * any provider, transport or shape problem fails closed: the caller gets a
//     rejected promise and an `ok: false` result, never partial or
//     provenance-free data.
//
// Nothing here opens, or claims to open, a real Bright Data connection. The
// adapter is always `simulated`: it reports the injected transport, never a
// real provider session.
import { createHash } from 'node:crypto';

const PROVIDER_NAMES = new Set(['brightdata', 'brightdata-scraper-studio']);

// Shape of the version-controlled per-source contract (same `schema.required`
// contract the fixture parsers use, plus the source URL host allowlist).
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ALLOWED_HTTP_METHODS = new Set(['GET']);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export class BrightDataError extends Error {
  constructor(message, { code = 'unknown', cause } = {}) {
    super(message);
    this.name = 'BrightDataError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(message, code = 'shape') {
  throw new BrightDataError(message, { code });
}

function asPlainObject(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || typeof value === 'function') {
    fail(`${label} must be a plain object`, 'config');
  }
  return value;
}

function assertString(value, label, { maxLength = 2048 } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`, 'config');
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) fail(`${label} is too long`, 'config');
  return trimmed;
}

function assertAllowedKeys(allowed, keys, label) {
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail(`${label} contains unsupported keys: ${unknown.join(', ')}`, 'config');
  }
}

function assertSafeUrl(raw, label, allowedHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} must be an absolute URL`, 'config');
  }
  if (url.protocol !== 'https:') fail(`${label} must use https`, 'config');
  if (url.username || url.password) fail(`${label} must not embed credentials`, 'config');
  if (url.search || url.hash) fail(`${label} must not carry a query string or fragment`, 'config');
  if (allowedHosts && !allowedHosts.includes(url.hostname)) {
    fail(`${label} host is not in the source contract allowlist`, 'config');
  }
  return url.toString();
}

function assertNoCredentialLiterals(value, label) {
  const text = typeof value === 'string' ? value : safeStringify(value);
  for (const pattern of CREDENTIAL_SHAPES) {
    const match = text.match(pattern);
    if (match) fail(`${label} appears to embed a credential literal (${match[0]})`, 'config');
  }
}

const CREDENTIAL_SHAPES = [
  /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/, // e-mail / user@host shaped values
  /\b(?:secret|password|passwd|token|apikey|api_key|access_key|accesskey)[=:/_-][^\s,;]+/i,
  /\b[A-Z]{2,}_[A-Z0-9_]{8,}\b/, // FLAGGED_STYLE secret literals
  /\b(?:brightdata|bright_data|api|access)[_-]?key\b/i,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
  /\b(?:sk|pk|pub)[-_]?key\b/i,
  /\b\d{12,}\b/, // long opaque numeric identifiers (account/zone ids)
];

function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty ISO-8601 timestamp`, 'provenance');
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) fail(`${label} is not a valid timestamp`, 'provenance');
  return parsed.toISOString();
}

function normalizeSourceUrl(value, { allowedHosts } = {}) {
  const raw = assertString(value, 'source URL', { maxLength: 2048 });
  return assertSafeUrl(raw, 'source URL', allowedHosts);
}

function normalizeTags(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array of strings`, 'shape');
  }
  const tags = [];
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.trim() === '') fail(`${label} must contain non-empty strings`, 'shape');
    const cleaned = tag.trim().toLowerCase();
    if (!tags.includes(cleaned)) tags.push(cleaned);
  }
  return tags;
}

function normalizeUrgency(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    fail(`${label} must be an integer from 1 through 5`, 'shape');
  }
  return value;
}

const RECORD_KEYS = new Set(['title', 'summary', 'nonprofit', 'causeTags', 'urgency', 'action', 'sourceUrl', 'fetchedAt', 'url', 'link', 'observedAt', 'scrapedAt']);

function normalizeRecord(record, { source, allowedHosts }) {
  if (typeof record !== 'object' || record === null || Array.isArray(record) || typeof record === 'function') {
    fail('record must be a plain object', 'shape');
  }
  if (record.sourceUrl !== undefined && record.url !== undefined && record.sourceUrl !== record.url) {
    fail('record.sourceUrl and record.url disagree', 'shape');
  }
  const suppliedTimestamps = [record.fetchedAt, record.observedAt, record.scrapedAt]
    .filter((value) => value !== undefined);
  if (new Set(suppliedTimestamps).size > 1) {
    fail('record.fetchedAt provenance aliases disagree', 'shape');
  }
  const unknown = Object.keys(record).filter((key) => !RECORD_KEYS.has(key));
  if (unknown.length > 0) fail(`record contains unsupported keys: ${unknown.join(', ')}`, 'shape');

  const title = assertString(record.title, 'record.title', { maxLength: 512 });
  const summary = assertString(record.summary, 'record.summary', { maxLength: 4096 });
  const nonprofit = assertString(record.nonprofit, 'record.nonprofit', { maxLength: 512 });
  assertNoCredentialLiterals(title, 'record.title');
  assertNoCredentialLiterals(summary, 'record.summary');
  assertNoCredentialLiterals(nonprofit, 'record.nonprofit');
  const causeTags = normalizeTags(record.causeTags, 'record.causeTags');
  const urgency = normalizeUrgency(record.urgency, 'record.urgency');
  for (const tag of causeTags) assertNoCredentialLiterals(tag, 'record.causeTags');

  let action;
  if (record.action !== undefined) {
    assertString(record.action, 'record.action', { maxLength: 1024 });
    action = record.action.trim();
    assertNoCredentialLiterals(action, 'record.action');
  }

  // Provenance is mandatory: a record without both a source URL and a fetched
  // timestamp can never become a CauseSignal.
  const rawSourceUrl = record.sourceUrl ?? record.url ?? record.link;
  if (rawSourceUrl === undefined) fail('record.sourceUrl is required provenance', 'provenance');
  const sourceUrl = normalizeSourceUrl(rawSourceUrl, { allowedHosts });
  // Never fall back to an adapter clock ("now"): provenance must be supplied by
  // the caller or the provider payload, otherwise the record fails closed.
  const rawFetchedAt = record.fetchedAt ?? record.observedAt ?? record.scrapedAt;
  if (rawFetchedAt === undefined) {
    fail('record.fetchedAt must be supplied by the caller or provider (never defaulted to now)', 'provenance');
  }
  const fetchedAt = normalizeTimestamp(rawFetchedAt, 'record.fetchedAt');

  return {
    id: `cause-${sha256(`${source.id}|${sourceUrl}|${title}`).slice(0, 32)}`,
    title,
    summary,
    nonprofit,
    causeTags,
    urgency,
    ...(action ? { action } : {}),
    source: source.id,
    sourceUrl,
    fetchedAt,
    provenance: {
      sourceId: source.id,
      sourceUrl,
      fetchedAt,
      adapter: 'brightdata',
      mode: 'simulated',
    },
  };
}

function normalizePayload(payload, { source, contract }) {
  if (typeof payload !== 'object' || payload === null || typeof payload === 'function') {
    fail('provider payload must be a plain object', 'provider');
  }
  if (!Array.isArray(payload.records)) {
    fail('provider payload must contain a records array', 'provider');
  }
  const allowedHosts = Array.isArray(contract.allowedHosts) ? contract.allowedHosts : undefined;
  const signals = [];
  for (const record of payload.records) {
    const signal = normalizeRecord(record, { source, allowedHosts });
    for (const field of contract.required) {
      if (signal[field] === undefined || signal[field] === null) {
        fail(`record is missing contract field: ${field}`, 'shape');
      }
    }
    signals.push(signal);
  }
  return signals;
}

function normalizeEnvelope(envelope, { source, contract }) {
  if (typeof envelope !== 'object' || envelope === null || typeof envelope === 'function') {
    fail('provider response envelope must be a plain object', 'provider');
  }
  if (typeof envelope.status !== 'number') {
    fail('provider response is missing an HTTP status', 'provider');
  }
  if (envelope.status < 200 || envelope.status >= 300) {
    fail(`provider responded with status ${envelope.status}`, 'provider');
  }
  if (typeof envelope.contentType !== 'string' || !/application\/json/i.test(envelope.contentType)) {
    fail('provider response is not application/json', 'provider');
  }
  if (typeof envelope.body !== 'string') {
    fail('provider response body must be a string', 'provider');
  }
  if (Buffer.byteLength(envelope.body, 'utf8') > MAX_RESPONSE_BYTES) {
    fail('provider response exceeded the bounded size limit', 'provider');
  }
  let payload;
  try {
    payload = JSON.parse(envelope.body);
  } catch (cause) {
    throw new BrightDataError('provider response body is not valid JSON', { code: 'provider', cause });
  }
  return normalizePayload(payload, { source, contract });
}

async function callTransport(request, { transport, timeoutMs }) {
  let timeout;
  const abort = new AbortController();
  if (timeoutMs > 0) {
    timeout = setTimeout(() => abort.abort(), timeoutMs);
  }
  try {
    const result = await transport({ ...request, signal: abort.signal });
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Validate the caller-supplied configuration. No credential value is ever
 * stored, echoed, or compared here — only its shape is checked, so that a
 * literal can never reach a request, a log line or a stored record.
 */
export function createBrightDataAdapter(options = {}) {
  if (typeof options !== 'object' || options === null || typeof options === 'function') {
    fail('adapter options must be a plain object', 'config');
  }
  // The boundary deliberately accepts no clock: every record must carry its
  // own provider-supplied provenance timestamp.
  const allowedOptionKeys = new Set(['provider', 'transport', 'credentials', 'config', 'source', 'contract']);
  const injectedContract = options.contract;
  assertAllowedKeys(allowedOptionKeys, Object.keys(options), 'adapter options');

  const { provider, transport, credentials, config, source } = options;

  if (!provider || typeof provider.name !== 'string' || !PROVIDER_NAMES.has(provider.name)) {
    fail('provider.name must be a recognised provider name', 'config');
  }
  if (provider.mode !== undefined && provider.mode !== 'simulated') {
    fail('this boundary only supports the simulated provider mode', 'config');
  }
  if (provider.sessionId !== undefined || provider.zoneId !== undefined || provider.token !== undefined) {
    fail('provider identity fields must not be supplied to this boundary', 'config');
  }
  if (typeof transport !== 'function') fail('transport must be an injected function', 'config');
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('source must be the version-controlled source contract', 'config');
  }
  if (!SOURCE_ID_PATTERN.test(source.id ?? '')) fail('source.id is not a safe identifier', 'config');
  if (typeof source.url !== 'string') fail('source.url is required by the source contract', 'config');

  const sourceContract = asPlainObject(source.schema, 'source.schema');
  const required = Array.isArray(sourceContract.required) ? sourceContract.required : [];
  if (required.length === 0) fail('source.schema.required must list the contract fields', 'config');
  const allowedHosts = sourceContract.allowedHosts;
  if (allowedHosts !== undefined && (!Array.isArray(allowedHosts) || allowedHosts.some((h) => typeof h !== 'string'))) {
    fail('source.schema.allowedHosts must be an array of hostnames', 'config');
  }

  if (injectedContract !== undefined) {
    // A caller may restate the contract, but may not weaken the provenance
    // requirement enforced below.
    asPlainObject(injectedContract, 'contract');
    if (!Array.isArray(injectedContract.required) || injectedContract.required.length === 0) {
      fail('contract.required must list the contract fields', 'config');
    }
  }

  const contract = {
    required: [...new Set([...required, 'sourceUrl', 'fetchedAt'])],
    allowedHosts,
  };

  const resolvedConfig = asPlainObject(config, 'config');
  const configKeys = new Set(['timeoutMs', 'maxResponseBytes', 'headers']);
  assertAllowedKeys(configKeys, Object.keys(resolvedConfig), 'config');
  const timeoutMs = resolvedConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) {
    fail('config.timeoutMs must be a positive integer', 'config');
  }
  if (resolvedConfig.headers !== undefined) {
    asPlainObject(resolvedConfig.headers, 'config.headers');
    assertNoCredentialLiterals(Object.keys(resolvedConfig.headers), 'config.headers');
  }

  const resolvedCredentials = asPlainObject(credentials, 'credentials');
  const credentialKeys = Object.keys(resolvedCredentials);
  assertAllowedKeys(new Set(['kind']), credentialKeys, 'credentials');
  if (credentialKeys.length > 0 && resolvedCredentials.kind !== 'injected-by-caller') {
    fail('credentials.kind must be "injected-by-caller"', 'config');
  }
  // Guard the *shape* of what the caller passed so a literal can never be
  // carried into a request, but never retain the values themselves.
  assertNoCredentialLiterals(credentialKeys, 'credentials keys');
  if (credentialKeys.length > 0) {
    fail('credentials must be opaque to this boundary (use credentials.kind only)', 'config');
  }

  const sourceUrl = assertSafeUrl(source.url, 'source.url', allowedHosts);

  const request = Object.freeze({
    provider: provider.name,
    mode: 'simulated',
    sourceId: source.id,
    sourceUrl,
    method: 'GET',
    headers: Object.freeze({ accept: 'application/json' }),
  });

  if (!ALLOWED_HTTP_METHODS.has(request.method)) fail('unsupported request method', 'config');

  return {
    mode: 'simulated',
    request,

    /** The caller's transport, never a provider SDK and never its own socket. */
    async fetchCauseSignals() {
      let envelope;
      try {
        envelope = await callTransport(request, { transport, timeoutMs });
      } catch (cause) {
        throw new BrightDataError('provider transport failed', { code: 'transport', cause });
      }
      const signals = normalizeEnvelope(envelope, { source, contract });
      return {
        ok: true,
        mode: 'simulated',
        source: { id: source.id, url: sourceUrl },
        signals,
      };
    },
  };
}

/**
 * Convenience wrapper: run one simulated provider round trip through an
 * injected transport and return only provenance-complete CauseSignals.
 * Rejects (fail closed) on any provider, transport or shape problem.
 */
export async function fetchCauseSignals(options = {}) {
  const adapter = createBrightDataAdapter(options);
  return adapter.fetchCauseSignals();
}

export const __internals = { normalizeRecord, CREDENTIAL_SHAPES, RECORD_KEYS };
