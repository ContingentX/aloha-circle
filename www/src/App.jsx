import { useEffect, useState } from 'react';
import { api } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { AuthButton, LocalVerifyCard, NpoVerifyCard } from './Verify.jsx';
import { DonationWheel, ExperienceManager } from './Wheel.jsx';
import { LiveStrip, CauseScroller } from './Causes.jsx';
import { World } from './World.jsx';
import { AlohaCircle } from './AlohaCircle.jsx';
import { FEATURED_NONPROFITS } from './nonprofits.js';

const INTEREST_OPTIONS = [
  'ocean', 'diving', 'hiking', 'wildlife', 'photography', 'farming',
  'cooking', 'community', 'trails', 'reef', 'family', 'music',
];

function InterestPicker({ selected, onToggle }) {
  return (
    <div className="chips">
      {INTEREST_OPTIONS.map((tag) => (
        <button
          key={tag}
          type="button"
          className={selected.includes(tag) ? 'chip chip-on' : 'chip'}
          onClick={() => onToggle(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}

function MatchCard({ match }) {
  return (
    <div className="card match-card">
      <h3>🌊 Your Maui Match</h3>
      <p><strong>Meet:</strong> {match.localName}, {match.localTown}</p>
      <p><strong>Cause:</strong> {match.cause}</p>
      <p><strong>Why:</strong> {match.why}</p>
      <p><strong>Today:</strong> {match.suggestedAction}</p>
    </div>
  );
}

function VisitorTab() {
  const [name, setName] = useState('');
  const [interests, setInterests] = useState([]);
  const [match, setMatch] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (tag) =>
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  // If the Aloha Agent API is unreachable, never dead-end the flow: match
  // against the static featured-nonprofits list instead.
  const fallbackMatch = () => {
    const np = FEATURED_NONPROFITS.find((n) => n.causeTags.some((t) => interests.includes(t)))
      ?? FEATURED_NONPROFITS[0];
    return {
      localName: 'Leilani', localTown: 'Paia',
      cause: np.name,
      why: `You picked ${interests.join(', ')} - ${np.tagline}.`,
      suggestedAction: np.experience,
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { match } = await api.post('/api/visitors', { name, interests });
      setMatch(match);
    } catch {
      setMatch(fallbackMatch());
    } finally {
      setBusy(false);
    }
  };

  if (match) {
    return <MatchCard match={match} />;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>What brought you to Maui?</h3>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      <p className="hint">Pick what you love — the Aloha Agent finds a local, a cause, and something you can do today.</p>
      <InterestPicker selected={interests} onToggle={toggle} />
      <button className="cta" disabled={busy || !name || interests.length === 0}>
        {busy ? 'Matching…' : 'Meet Maui'}
      </button>
    </form>
  );
}

function LocalTab() {
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [interests, setInterests] = useState([]);
  const [done, setDone] = useState(false);
  const [nonprofits, setNonprofits] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/nonprofits')
      .then((list) => setNonprofits(Array.isArray(list) ? list : []))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = (tag) =>
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/locals', { name, town, interests, causes: interests });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const endorse = async (nonprofit, verdict) => {
    setError(null);
    try {
      await api.post('/api/endorsements', { local: name || 'anonymous local', nonprofit: nonprofit.name, verdict });
      const list = await api.get('/api/nonprofits');
      setNonprofits(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <LocalVerifyCard />
      {!done ? (
        <form className="card" onSubmit={submit}>
          <h3>I live here 🤙</h3>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Town (Lahaina, Paia, …)" value={town} onChange={(e) => setTown(e.target.value)} />
          <p className="hint">What do you care about? Visitors get matched to you through shared interests.</p>
          <InterestPicker selected={interests} onToggle={toggle} />
          <button className="cta" disabled={!name || interests.length === 0}>Join as a local</button>
        </form>
      ) : (
        <div className="card"><h3>Mahalo, {name}! You're on the local roster.</h3></div>
      )}
      <div className="card">
        <h3>Is this helping Maui?</h3>
        <p className="hint">Verified locals are the trust layer — your calls power every match.</p>
        {nonprofits.map((np) => (
          <div key={np.id} className="np-row">
            <div>
              <strong>{np.name}</strong>
              <span className="hint"> · {np.helpingNow} locals say helping now</span>
            </div>
            <div className="np-actions">
              <button onClick={() => endorse(np, 'helping_now')}>Helping now</button>
              <button onClick={() => endorse(np, 'generally_helping')}>Generally</button>
              <button onClick={() => endorse(np, 'not_sure')}>Not sure</button>
              <button onClick={() => endorse(np, 'causing_concern')}>Concern</button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function NonprofitTab() {
  const [form, setForm] = useState({ name: '', website: '', causeTags: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/nonprofits', {
        name: form.name,
        website: form.website,
        causeTags: form.causeTags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (done) {
    return (
      <div>
        <NpoVerifyCard />
        <ExperienceManager />
        <div className="card"><h3>Mahalo! {form.name} is listed — locals can now endorse you.</h3></div>
      </div>
    );
  }

  return (
    <div>
    <NpoVerifyCard />
    <ExperienceManager />
    <form className="card" onSubmit={submit}>
      <h3>List your cause</h3>
      <input placeholder="Organization name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <input placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      <input placeholder="Cause tags, comma-separated (reef, trails, food-security)" value={form.causeTags} onChange={(e) => setForm({ ...form, causeTags: e.target.value })} required />
      <button className="cta">List nonprofit</button>
      {error && <p className="error">{error}</p>}
    </form>
    </div>
  );
}

const clampUrgency = (u) => Math.min(5, Math.max(1, Number.isFinite(Number(u)) ? Math.round(Number(u)) : 1));

function NeedsTab() {
  const [causes, setCauses] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/causes')
      .then((list) => setCauses(Array.isArray(list) ? list : []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="card">
      <h3>Maui Needs Index — live</h3>
      <p className="hint">Continuously ingested by the Aloha Agent from local nonprofit boards, news and event pages.</p>
      {error && <p className="error">{error}</p>}
      {causes.map((c) => (
        <div key={c.id} className="cause-row">
          <div className="urgency" title={`urgency ${clampUrgency(c.urgency)}/5`}>{'●'.repeat(clampUrgency(c.urgency))}</div>
          <div>
            <strong>{c.title}</strong>
            <p className="hint">{c.summary}</p>
            <p className="tags">{(Array.isArray(c.causeTags) ? c.causeTags : []).map((t) => `#${t}`).join(' ')}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'visitor', label: "I'm visiting", el: <VisitorTab /> },
  { id: 'local', label: 'I live here', el: <LocalTab /> },
  { id: 'nonprofit', label: "We're a nonprofit", el: <NonprofitTab /> },
  { id: 'needs', label: 'Live needs', el: <NeedsTab /> },
];

// Role sections (visitor / local / nonprofit / live needs) live behind the
// signed-in user chip; closes itself if the user signs out.
function AccountSection({ onClose }) {
  const { user, ready } = useAuth();
  const [tab, setTab] = useState('visitor');
  useEffect(() => { if (ready && !user) onClose(); }, [ready, user]);
  if (!user) return null;
  return (
    <div>
      <div className="account-head">
        <h2>Aloha, {user.displayName?.split(' ')[0] ?? 'friend'}</h2>
        <button className="link-btn" onClick={onClose}>← Back to the site</button>
      </div>
      <nav>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab tab-on' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>{TABS.find((t) => t.id === tab).el}</main>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('home'); // 'home' | 'account'
  return (
    <AuthProvider>
    <World />
    <div className="page" id="app">
      <header>
        <div className="header-row">
          <h1>Aloha<span className="accent">Live</span></h1>
          <AuthButton onOpenAccount={() => setView((v) => (v === 'account' ? 'home' : 'account'))} />
        </div>
        <p className="tagline">Don't just visit Maui. <strong>Meet Maui.</strong></p>
        <LiveStrip />
      </header>
      {view === 'account' ? (
        <AccountSection onClose={() => setView('home')} />
      ) : (
        <>
          <CauseScroller />
          <AlohaCircle />
          <main>
            <DonationWheel />
            <VisitorTab />
          </main>
        </>
      )}
      <footer>
        <p>The Aloha Circle · Kahului Airport (OGG) · <a href="https://alohalive.net">alohalive.net</a></p>
      </footer>
    </div>
    </AuthProvider>
  );
}
