import { useState } from 'react';
import { useAuth, emailDomain, normalizeDomain } from './auth.jsx';
import { AIRPORTS } from './firebase.js';

export function AuthButton({ onOpenAccount }) {
  const { user, profile, ready, profileError, signInWithGoogle, signOutUser } = useAuth();
  const [error, setError] = useState(null);
  if (!ready) return null;
  if (!user) {
    return (
      <div className="auth-box">
        <button className="google-btn" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
          Sign in with Google
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="auth-box">
      <button className="user-chip" onClick={onOpenAccount} title="Your account">
        {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
        <span>{user.displayName}</span>
      </button>
      <VerifiedBadge verification={profile?.verification} />
      <button className="link-btn" onClick={signOutUser}>Sign out</button>
      {profileError && <p className="error">{profileError}</p>}
    </div>
  );
}

export function VerifiedBadge({ verification }) {
  if (!verification) return null;
  if (verification.status === 'verified') return <span className="badge badge-ok" title="Verified">✓ verified</span>;
  if (verification.status === 'pending') return <span className="badge" title="Awaiting review">⏳ pending</span>;
  return null;
}

function SignInPrompt({ children }) {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState(null);
  return (
    <div className="card">
      <h3>{children}</h3>
      <button className="cta" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
        Sign in with Google
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Locals: pick your airport (OGG only for now) + upload a bill photo showing a
// local address. Review sets the verified flag.
export function LocalVerifyCard() {
  const { user, profile, ready, submitLocalVerification } = useAuth();
  const [airport, setAirport] = useState(AIRPORTS[0].code);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!ready) return null;
  if (!user) return <SignInPrompt>Get verified as a Maui local</SignInPrompt>;

  const v = profile?.verification;
  if (profile?.role === 'local' && v?.status === 'verified') {
    return <div className="card"><h3>✓ You're a verified local</h3><p className="hint">Your endorsements now carry verified weight.</p></div>;
  }
  if (v?.status === 'pending' && v.method === 'bill-photo') {
    return <div className="card"><h3>⏳ Verification submitted</h3><p className="hint">We're reviewing your document — you'll show as verified once it's approved.</p></div>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitLocalVerification(airport, file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>Get verified as a local</h3>
      <label className="hint" htmlFor="airport">Your island's airport</label>
      <select id="airport" value={airport} onChange={(e) => setAirport(e.target.value)}>
        {AIRPORTS.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
      </select>
      <p className="hint">
        Upload a photo of a utility bill or similar document showing your name and a Maui address.
        It's only used for residency review, never shown publicly.
      </p>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
      <button className="cta" disabled={busy || !file}>{busy ? 'Uploading…' : 'Submit for review'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// Nonprofits: claim your domain. If your Google account is on that domain
// you're verified instantly; otherwise we email a 6-digit code to an inbox
// at the domain.
export function NpoVerifyCard() {
  const { user, profile, ready, claimNpoDomain, sendDomainCode, verifyDomainCode } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [domain, setDomain] = useState('');
  const [proofEmail, setProofEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState(null); // null | 'needs-email-proof' | 'code-sent'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!ready) return null;
  if (!user) return <SignInPrompt>Verify your nonprofit</SignInPrompt>;

  const v = profile?.verification;
  if (profile?.role === 'nonprofit' && v?.status === 'verified') {
    return (
      <div className="card">
        <h3>✓ {profile.orgName || profile.domain} is verified</h3>
        <p className="hint">Verified via {v.method === 'google-domain' ? 'your Google Workspace domain' : `email code to ${v.proofEmail}`}.</p>
      </div>
    );
  }

  const claimedDomain = normalizeDomain(domain) || profile?.domain || '';
  const effectiveStage = stage ?? (profile?.role === 'nonprofit' && v?.status === 'pending' && v.method === 'email-code' ? 'code-sent' : profile?.role === 'nonprofit' && profile?.domain ? 'needs-email-proof' : null);

  const wrap = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const claim = wrap(async () => {
    const result = await claimNpoDomain(domain, orgName);
    setStage(result === 'verified' ? null : 'needs-email-proof');
  });
  const sendCode = wrap(async () => {
    await sendDomainCode(proofEmail.trim().toLowerCase());
    setStage('code-sent');
  });
  const checkCode = wrap(async () => {
    await verifyDomainCode(code);
    setStage(null);
  });

  if (effectiveStage === 'code-sent') {
    return (
      <form className="card" onSubmit={checkCode}>
        <h3>Enter the code we emailed {v?.proofEmail || proofEmail}</h3>
        <input
          inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
          value={code} onChange={(e) => setCode(e.target.value)} required
        />
        <button className="cta" disabled={busy || code.trim().length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
        <button type="button" className="link-btn" onClick={() => setStage('needs-email-proof')}>Send a new code</button>
        {error && <p className="error">{error}</p>}
      </form>
    );
  }

  if (effectiveStage === 'needs-email-proof') {
    return (
      <form className="card" onSubmit={sendCode}>
        <h3>Prove you're part of {claimedDomain}</h3>
        <p className="hint">
          Your Google account ({user.email}) isn't on {claimedDomain}, so we'll email a verification
          code to an address at that domain.
        </p>
        <input
          type="email" placeholder={`you@${claimedDomain}`} value={proofEmail}
          onChange={(e) => setProofEmail(e.target.value)} required
        />
        <button className="cta" disabled={busy || emailDomain(proofEmail.trim()) !== claimedDomain}>
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    );
  }

  return (
    <form className="card" onSubmit={claim}>
      <h3>Verify your nonprofit</h3>
      <input placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
      <input placeholder="Your website domain (mauireef.org)" value={domain} onChange={(e) => setDomain(e.target.value)} required />
      <p className="hint">
        Signed in as {user.email}
        {normalizeDomain(domain) && emailDomain(user.email) === normalizeDomain(domain)
          ? ' — that matches your domain, so you\'ll be verified instantly.'
          : normalizeDomain(domain) ? ` — we'll email a code to an @${normalizeDomain(domain)} inbox to confirm.` : '.'}
      </p>
      <button className="cta" disabled={busy || !orgName || !normalizeDomain(domain)}>{busy ? 'Checking…' : 'Claim domain'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
