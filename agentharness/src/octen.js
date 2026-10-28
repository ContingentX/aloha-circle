// Octen Web Search adapter for the Maui Needs Index.
//
// Octen (https://docs.octen.ai) replaces the simulated Bright Data boundary as
// the live scraping provider: one POST to https://api.octen.ai/search returns
// ranked live-web results with highlights and crawl timestamps, which this
// module normalises into the project CauseSignal shape.
//
// Boundary rules (same spirit as the old brightdata.js seam):
//   * no environment reads — the API key and (optionally) a fetch
//     implementation are injected by the caller;
//   * every signal carries provenance (source URL + provider crawl timestamp);
//   * provider/shape problems fail closed with a rejected promise, so the
//     ingest loop flags the source needs_repair and fixtures keep running.
const OCTEN_SEARCH_URL = 'https://api.octen.ai/search';
const DEFAULT_COUNT = 10;
const MAX_SUMMARY_CHARS = 600;
const DEFAULT_TIMEOUT_MS = 20_000;

export class OctenError extends Error {
  constructor(message, { code = 'unknown', cause } = {}) {
    super(message);
    this.name = 'OctenError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(message, code) {
  throw new OctenError(message, { code });
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function validateOctenSourceConfig(source) {
  const octen = source?.octen;
  if (typeof octen !== 'object' || octen === null || Array.isArray(octen)) {
    fail(`source ${source?.id ?? '?'} is missing its octen config block`, 'config');
  }
  const query = cleanText(octen.query);
  if (!query) fail(`source ${source.id} octen.query must be a non-empty string`, 'config');
  if (!Array.isArray(octen.causeTags) || octen.causeTags.length === 0
    || octen.causeTags.some((t) => typeof t !== 'string' || t.trim() === '')) {
    fail(`source ${source.id} octen.causeTags must be a non-empty string array`, 'config');
  }
  const urgency = octen.urgency ?? 2;
  if (!Number.isInteger(urgency) || urgency < 1 || urgency > 5) {
    fail(`source ${source.id} octen.urgency must be an integer 1-5`, 'config');
  }
  const count = octen.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    fail(`source ${source.id} octen.count must be an integer 1-25`, 'config');
  }
  const request = { query, count };
  for (const key of ['include_domains', 'exclude_domains', 'include_text', 'exclude_text']) {
    if (octen[key] !== undefined) {
      if (!Array.isArray(octen[key]) || octen[key].some((v) => typeof v !== 'string')) {
        fail(`source ${source.id} octen.${key} must be a string array`, 'config');
      }
      request[key] = octen[key];
    }
  }
  return {
    request,
    causeTags: octen.causeTags.map((t) => t.trim().toLowerCase()),
    urgency,
  };
}

function toCauseSignal(result, { sourceId, causeTags, urgency }) {
  const title = cleanText(result?.title);
  const url = typeof result?.url === 'string' ? result.url.trim() : '';
  if (!title || !/^https:\/\//.test(url)) return null;
  const summary = cleanText(result.highlight) || title;
  const fetchedAt = normalizeTimestamp(result.time_last_crawled)
    ?? normalizeTimestamp(result.time_published);
  return {
    title,
    summary: summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary,
    causeTags,
    urgency,
    url,
    sourceUrl: url,
    source: sourceId,
    ...(fetchedAt ? { fetchedAt } : {}),
    provenance: { sourceId, sourceUrl: url, adapter: 'octen', mode: 'live', ...(fetchedAt ? { fetchedAt } : {}) },
  };
}

/**
 * Run one Octen Web Search for a sources.json entry and return CauseSignals.
 * Fails closed (rejects) on any transport, auth, or payload-shape problem.
 */
export async function fetchCauseSignals({ source, apiKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    fail('octen API key must be injected by the caller (set OCTEN_API_KEY)', 'config');
  }
  const { request, causeTags, urgency } = validateOctenSourceConfig(source);

  let response;
  try {
    response = await fetchImpl(OCTEN_SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey.trim() },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new OctenError('octen transport failed', { code: 'transport', cause });
  }
  if (!response.ok) fail(`octen responded with HTTP ${response.status}`, 'provider');

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new OctenError('octen response body is not valid JSON', { code: 'provider', cause });
  }
  if (payload?.code !== 0) {
    fail(`octen returned code ${payload?.code ?? '?'}: ${cleanText(payload?.msg) || 'unknown error'}`, 'provider');
  }
  const results = payload?.data?.results;
  if (!Array.isArray(results)) fail('octen response is missing data.results', 'provider');

  const seen = new Set();
  const signals = [];
  for (const result of results) {
    const signal = toCauseSignal(result, { sourceId: source.id, causeTags, urgency });
    if (!signal || seen.has(signal.url)) continue;
    seen.add(signal.url);
    signals.push(signal);
  }
  if (signals.length === 0) fail('octen returned no usable results for this query', 'provider');
  return signals;
}
