const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

function assertBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ALOHALIVE_PUBLIC_API_BASE is required');
  }
  const url = new URL(value.trim());
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('ALOHALIVE_PUBLIC_API_BASE must be HTTPS or an HTTP loopback URL without credentials');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function assertVisitorResult(body) {
  if (!body || typeof body !== 'object' || !body.visitor || typeof body.visitor.id !== 'string') {
    throw new Error('AlohaLive public API response is missing visitor.id');
  }
  if (body.match !== null && (
    !body.match ||
    typeof body.match.id !== 'string' ||
    body.match.visitorId !== body.visitor.id ||
    typeof body.match.localId !== 'string' ||
    typeof body.match.causeId !== 'string' ||
    !Number.isFinite(body.match.score) ||
    body.match.scoreReceipt?.total !== body.match.score
  )) {
    throw new Error('AlohaLive public API response has an invalid match contract');
  }
  return body;
}

export function createPublicApiClient({
  baseUrl = process.env.ALOHALIVE_PUBLIC_API_BASE,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = assertBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  return {
    async createVisitorAndMatch(input) {
      const response = await fetchImpl(new URL(`${base.pathname}/api/visitors`, base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_RESPONSE_BYTES) throw new Error('AlohaLive public API response is too large');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('AlohaLive public API response is too large');
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error('AlohaLive public API returned invalid JSON');
      }
      if (!response.ok) throw new Error(body?.error || `AlohaLive public API returned ${response.status}`);
      return assertVisitorResult(body);
    },
  };
}
