import { auth } from './firebase.js';

// The AlohaLive API (Lambda behind API Gateway) — profiles, verification,
// experiences, donations. Distinct from ./api.js, which talks to the local
// agentharness matcher in dev. Deploy workflows configure the endpoint via
// VITE_API_BASE (per-environment repo vars); VITE_API remains an explicit
// override, and the hard-coded host is only the local-dev fallback.
export const API_BASE =
  import.meta.env.VITE_API ??
  import.meta.env.VITE_API_BASE ??
  'https://vsrvqrddll.execute-api.us-east-1.amazonaws.com';

async function request(path, { method = 'GET', body, authed = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (authed) {
    const user = auth.currentUser;
    if (!user) throw new Error('sign in required');
    headers.authorization = `Bearer ${await user.getIdToken()}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const appApi = {
  me: () => request('/me', { authed: true }),
  saveProfile: (fields) => request('/profile', { method: 'POST', body: fields, authed: true }),
  npoClaim: (orgName, domain) => request('/npo/claim', { method: 'POST', body: { orgName, domain }, authed: true }),
  npoSendCode: (email) => request('/npo/send-code', { method: 'POST', body: { email }, authed: true }),
  npoVerifyCode: (code) => request('/npo/verify-code', { method: 'POST', body: { code }, authed: true }),
  localSubmit: (airport, contentType) => request('/local/submit', { method: 'POST', body: { airport, contentType }, authed: true }),
  localConfirm: (key) => request('/local/confirm', { method: 'POST', body: { key }, authed: true }),
  experiences: () => request('/experiences'),
  createExperience: (fields) => request('/experiences', { method: 'POST', body: fields, authed: true }),
  donate: (experienceId, amountUsd) => request('/donate', { method: 'POST', body: { experienceId, amountUsd } }),
  spin: (sessionId) => request(`/spin?session_id=${encodeURIComponent(sessionId)}`),
};
