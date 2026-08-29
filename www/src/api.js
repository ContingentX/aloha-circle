// In dev, Vite proxies /api to the agentharness on :8787.
// In prod (S3 static site), set VITE_API_BASE at build time.
const BASE = import.meta.env.VITE_API_BASE ?? '';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data) =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
};
