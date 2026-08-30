import { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';
import { appApi } from './appApi.js';

// Bridge pages for the native app. The Expo app opens these in an
// ASWebAuthenticationSession and we hand control back via its deep link:
//   /applogin?return=<deep-link>  → Google sign-in → <deep-link>#idToken=...
//   /appreturn?next=<deep-link>&spin=cs_... → <deep-link>#spin=cs_...
// Only app schemes may be redirect targets — never http(s), so these pages
// can't be used as open redirectors.
const APP_SCHEME = /^(exp|exps|alohalive):\/\//;

const target = (param) => {
  const uri = new URLSearchParams(window.location.search).get(param) ?? '';
  return APP_SCHEME.test(uri) ? uri : null;
};

const withFragment = (uri, fragment) => `${uri}${uri.includes('#') ? '&' : '#'}${fragment}`;

function AppLogin() {
  const ret = target('return');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await appApi.saveProfile({ name: cred.user.displayName ?? '', photoURL: cred.user.photoURL ?? '' });
      const idToken = await cred.user.getIdToken();
      window.location.replace(
        withFragment(ret, `idToken=${encodeURIComponent(idToken)}&name=${encodeURIComponent(cred.user.displayName ?? '')}`),
      );
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!ret) return <p className="error">Missing or invalid return link — open this page from the AlohaLive app.</p>;
  return (
    <>
      <p>Sign in to AlohaLive with your Google account, then you'll be sent right back to the app.</p>
      <button className="cta" disabled={busy} onClick={signIn}>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function AppReturn() {
  const next = target('next');
  const spin = new URLSearchParams(window.location.search).get('spin') ?? '';
  const href = next && (/^cs_[a-zA-Z0-9_]+$/.test(spin) ? withFragment(next, `spin=${spin}`) : next);

  useEffect(() => {
    if (href) window.location.replace(href);
  }, [href]);

  if (!href) return <p className="error">Missing or invalid return link — open this page from the AlohaLive app.</p>;
  return (
    <>
      <p>{spin ? 'Mahalo for your donation! 🌺' : 'Taking you back…'}</p>
      <a className="cta" href={href}>Return to the AlohaLive app</a>
    </>
  );
}

export default function AppBridge() {
  const login = window.location.pathname.startsWith('/applogin');
  return (
    <div className="page">
      <header>
        <h1>Aloha<span className="accent">Live</span></h1>
      </header>
      <div className="card">
        <h3>{login ? '🤙 Sign in' : '🎡 Back to the app'}</h3>
        {login ? <AppLogin /> : <AppReturn />}
      </div>
    </div>
  );
}
