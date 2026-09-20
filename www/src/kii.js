// Login with Masky + the aloha-intelligence kiʻi API. A user who has talked
// with Kiʻi (aloha-intelligence.ai/ancestors) signs in with the same Masky
// account here, and Aloha Circle reads the memories of those conversations to
// derive the causes they care about — the matcher input for their digital
// clone. Raw memories only travel to the matcher request; they are never
// stored by this site.
const AI_API = 'https://j9l4db543m.execute-api.us-east-1.amazonaws.com';
const OAUTH_CLIENT_ID = 'mkc_0afc3187d0595a2c73c313e1';

export const KII_HOME = 'https://aloha-intelligence.ai/ancestors';

const redirectUri = () => `${window.location.origin}/`;

// Strip the attribution prefix the kiʻi backend stores memories with — the
// matcher only needs the taught content.
const memoryContent = (memory) =>
  String(memory?.content ?? '').replace(/^\[taught by [^\]]*\]\s*/, '');

export function maskyLogin(role) {
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('kii_oauth_state', state);
  sessionStorage.setItem('kii_role', role);
  window.location.assign(
    'https://masky.ai/oauth-authorize.html' +
      `?client_id=${OAUTH_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&scope=profile&state=${state}`,
  );
}

// Finishes the OAuth round-trip when the home page loads with ?code=…
// Returns null when this page load is not a Masky callback.
export async function completeMaskyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return null;
  const state = params.get('state');
  window.history.replaceState({}, '', window.location.pathname);
  if (!state || state !== sessionStorage.getItem('kii_oauth_state')) {
    throw new Error('Sign-in state mismatch — please try again.');
  }
  sessionStorage.removeItem('kii_oauth_state');

  const call = async (path, options = {}) => {
    const res = await fetch(`${AI_API}${path}`, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `aloha-intelligence ${res.status}`);
    return body;
  };

  const token = await call('/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: redirectUri() }),
  });
  const recall = await call('/kii/memories', {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });

  return {
    name: token.name ?? '',
    role: sessionStorage.getItem('kii_role') === 'local' ? 'local' : 'traveller',
    memories: (recall.memories ?? []).map(memoryContent).filter(Boolean),
  };
}
