import { useEffect, useState } from 'react';
import { useAuth, emailDomain, normalizeDomain, pendingDomainProof, completeDomainProof } from './auth.jsx';
import { AIRPORTS } from './firebase.js';

export function AuthButton() {
  const { user, profile, ready, signInWithGoogle, signOutUser } = useAuth();
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
      {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
      <span>{user.displayName}</span>
      <VerifiedBadge verification={profile?.verification} />
      <button className="link-btn" onClick={signOutUser}>Sign out</button>
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
  if (v?.status === 'verified') {
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
        Upload a photo of a utility bill or similar document showing your name and a {airport === 'OGG' ? 'Maui' : 'local'} address.
        It's only used for residency review, never shown publicly.
      </p>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
      <button className="cta" disabled={busy || !file}>{busy ? 'Uploading…' : 'Submit for review'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// Nonprofits: claim your domain. If your Google account is on that domain
// you're verified instantly; otherwise we email a proof link to an inbox
// at the domain.
export function NpoVerifyCard() {
  const { user, profile, ready, claimNpoDomain, sendDomainProofLink } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [domain, setDomain] = useState('');
  const [proofEmail, setProofEmail] = useState('');
  const [stage, setStage] = useState('claim'); // claim | needs-email-proof | link-sent
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!ready) return null;
  if (!user) return <SignInPrompt>Verify your nonprofit</SignInPrompt>;

  const v = profile?.verification;
  if (profile?.role === 'nonprofit' && v?.status === 'verified') {
    return (
      <div className="card">
        <h3>✓ {profile.orgName || profile.domain} is verified</h3>
        <p className="hint">Verified via {v.method === 'google-domain' ? 'your Google Workspace domain' : `email proof to ${v.proofEmail}`}.</p>
      </div>
    );
  }

  const claimedDomain = normalizeDomain(domain || profile?.domain || '');

  const claim = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await claimNpoDomain(domain, orgName);
      if (result === 'needs-email-proof') setStage('needs-email-proof');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendDomainProofLink(proofEmail.trim(), claimedDomain);
      setStage('link-sent');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'link-sent' || (v?.status === 'pending' && v.method === 'email-link' && stage === 'claim')) {
    return (
      <div className="card">
        <h3>⏳ Check {v?.proofEmail || proofEmail}</h3>
        <p className="hint">Open the sign-in link we emailed — in this browser — to prove you control the domain. Then sign back in with Google.</p>
      </div>
    );
  }

  if (stage === 'needs-email-proof') {
    return (
      <form className="card" onSubmit={sendLink}>
        <h3>Prove you're part of {claimedDomain}</h3>
        <p className="hint">
          Your Google account ({user.email}) isn't on {claimedDomain}, so we'll email a verification link to an
          address at that domain.
        </p>
        <input
          type="email"
          placeholder={`you@${claimedDomain}`}
          value={proofEmail}
          onChange={(e) => setProofEmail(e.target.value)}
          required
        />
        <button className="cta" disabled={busy || emailDomain(proofEmail.trim()) !== claimedDomain}>
          {busy ? 'Sending…' : 'Send verification link'}
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
        {emailDomain(user.email) === claimedDomain && claimedDomain
          ? ' — that matches your domain, so you\'ll be verified instantly.'
          : claimedDomain ? ` — we'll ask for an @${claimedDomain} inbox to confirm.` : '.'}
      </p>
      <button className="cta" disabled={busy || !orgName || !claimedDomain}>{busy ? 'Checking…' : 'Claim domain'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// Full-screen takeover when the page is opened from a domain-proof email link.
export function DomainProofGate({ children }) {
  const [state, setState] = useState(() => (pendingDomainProof() !== null || window.location.search.includes('domainProof=1')) ? 'working' : 'idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (state !== 'working') return;
    completeDomainProof(pendingDomainProof())
      .then((domain) => { setResult(domain); setState('done'); })
      .catch((err) => { setError(err.message); setState('failed'); });
  }, []);

  if (state === 'idle') return children;
  if (state === 'working') return <div className="page"><div className="card"><h3>Verifying your domain…</h3></div></div>;
  if (state === 'done') {
    return (
      <div className="page">
        <div className="card">
          <h3>✓ {result} verified</h3>
          <p className="hint">Domain proof recorded. Sign back in with Google to continue as your nonprofit.</p>
          <button className="cta" onClick={() => { window.location.href = window.location.origin; }}>Continue</button>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="card">
        <h3>Verification failed</h3>
        <p className="error">{error}</p>
        <button className="cta" onClick={() => { window.location.href = window.location.origin; }}>Back to AlohaLive</button>
      </div>
    </div>
  );
}
