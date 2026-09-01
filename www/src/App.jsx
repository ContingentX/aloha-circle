import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { AuthButton, LocalVerifyCard, NpoVerifyCard } from './Verify.jsx';
import { DonationWheel, ExperienceManager } from './Wheel.jsx';
import { LiveStrip, CauseScroller } from './Causes.jsx';
import { World } from './World.jsx';
import { AlohaCircle } from './AlohaCircle.jsx';
import { FEATURED_NONPROFITS } from './nonprofits.js';

const TRUEFORGE_DEMO_ENABLED = import.meta.env.VITE_TRUEFORGE_DEMO === 'true';
const AGENT_CONSOLE_URL = import.meta.env.VITE_AGENT_CONSOLE_URL ?? '/agent-console';

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

function MatchCard({ match, agent }) {
  return (
    <div className="card match-card">
      <h3>🌊 Your Maui Match</h3>
      <p><strong>Meet:</strong> {match.localName}, {match.localTown}</p>
      <p><strong>Cause:</strong> {match.cause}</p>
      <p><strong>Why:</strong> {match.why}</p>
      <p><strong>Today:</strong> {match.suggestedAction}</p>
      {agent && (
        <div className="agent-receipt">
          <p><strong>Named TrueForge agent:</strong> <code>{agent.name}</code></p>
          <p><strong>Aloha Agent:</strong> {agent.pendingApprovals?.length ? 'Waiting for human approval' : agent.status}</p>
          <p>{agent.eventCount} TrueForge events · session <code>{agent.trueforgeSessionId}</code></p>
          <a href={AGENT_CONSOLE_URL} target="_blank" rel="noreferrer">Open the TrueForge operator view ↗</a>
        </div>
      )}
    </div>
  );
}

function VisitorTab() {
  const [name, setName] = useState('');
  const [interests, setInterests] = useState([]);
  const [match, setMatch] = useState(null);
  const [agent, setAgent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (tag) =>
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const fallbackMatch = () => {
    const nonprofit = FEATURED_NONPROFITS.find((item) =>
      item.causeTags.some((tag) => interests.includes(tag))) ?? FEATURED_NONPROFITS[0];
    return {
      localName: 'Leilani',
      localTown: 'Paia',
      cause: nonprofit.name,
      why: `You picked ${interests.join(', ')} - ${nonprofit.tagline}.`,
      suggestedAction: nonprofit.experience,
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAgent(null);
    try {
      const result = await api.post(
        TRUEFORGE_DEMO_ENABLED ? '/api/agent/runs' : '/api/visitors',
        { name, interests },
      );
      if (!result.match) throw new Error('No eligible Maui match is available yet.');
      setMatch(result.match);
      setAgent(TRUEFORGE_DEMO_ENABLED ? result.agent : null);
    } catch (requestError) {
      if (TRUEFORGE_DEMO_ENABLED) {
        setError(requestError instanceof Error ? requestError.message : 'Matching failed.');
      } else {
        setMatch(fallbackMatch());
      }
    } finally {
      setBusy(false);
    }
  };

  if (match) {
    return <MatchCard match={match} agent={agent} />;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>What brought you to Maui?</h3>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      <p className="hint">
        {TRUEFORGE_DEMO_ENABLED
          ? 'Pick what you love — the named Aloha Agent runs in TrueForge and pauses before any introduction.'
          : 'Pick what you love — Aloha Circle finds a local, a cause, and something you can do today.'}
      </p>
      <InterestPicker selected={interests} onToggle={toggle} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="cta" disabled={busy || !name || interests.length === 0}>
        {busy ? (TRUEFORGE_DEMO_ENABLED ? 'Running Aloha Agent…' : 'Matching…') : 'Meet Maui'}
      </button>
    </form>
  );
}

function LocalTab() {
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [interests, setInterests] = useState([]);
  const [done, setDone] = useState(false);
  const [localId, setLocalId] = useState(null);
  const [nonprofits, setNonprofits] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

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
      const local = await api.post('/api/locals', { name, town, interests, causes: interests });
      setLocalId(local.id);
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const endorse = async (nonprofit, verdict) => {
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/endorsements', {
        local: name || 'anonymous local', localId,
        nonprofit: nonprofit.name, nonprofitId: nonprofit.id, verdict,
      });
      setNotice('Mahalo — your endorsement is pending verification.');
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
        <div className="card"><h3>Mahalo, {name}! Your local profile is pending verification.</h3></div>
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
      {notice && <p className="hint">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function NonprofitTab() {
  const { user, ready } = useAuth();
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

  if (!ready) return null;
  if (!user) return <NpoVerifyCard />;

  if (done) {
    return (
      <div>
        <NpoVerifyCard />
        <ExperienceManager />
        <div className="card"><h3>Mahalo! {form.name} was submitted and is pending verification.</h3></div>
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
      <h3>Maui Needs Index — demo data</h3>
      <p className="hint">Loaded from DynamoDB now; the Aloha Agent will refresh these records from source-backed feeds.</p>
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

// Fixed full-viewport backdrop for everything after the scroll-world flight: a
// mostly-transparent Maui photo over the page gradient. During the hero's
// end-of-track handoff it rides in glued to the top of the page content (the
// hero's final scene rides up at the same rate just above it), then pins to the
// viewport once the page owns the screen — a rich fixed background the sections
// scroll over. Its top 30vh overhang is mask-faded so the seam blends into the
// departing scene instead of cutting across it.
function PageBackdrop({ wrapRef }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = 0;
      if (!ref.current || !wrapRef.current) return;
      const top = wrapRef.current.getBoundingClientRect().top;
      ref.current.style.transform = `translateY(${Math.max(0, top)}px)`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(place); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    place();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return <div className="page-backdrop" ref={ref} aria-hidden="true" />;
}

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
  const wrapRef = useRef(null);
  return (
    <AuthProvider>
    <World />
    {/* page-wrap paints above the hero's fixed layers (z-index > the stage's 120)
        so the app slides over the final scene and lands at the top of the screen;
        #app moves here so CTA anchors land at the true top. */}
    <div className="page-wrap" id="app" ref={wrapRef}>
    <PageBackdrop wrapRef={wrapRef} />
    <div className="page">
      <header>
        <div className="header-row">
          <div className="brand-lockup">
            <img className="brand-logo" src="/aloha-circle-logo.svg" alt="" />
            <h1>Aloha <span className="accent">Circle</span></h1>
          </div>
          <AuthButton onOpenAccount={() => setView((v) => (v === 'account' ? 'home' : 'account'))} />
        </div>
        <p className="tagline">Don't just visit Maui. <strong>Meet Maui.</strong></p>
        <LiveStrip />
      </header>
      {view === 'account' ? (
        <AccountSection onClose={() => setView('home')} />
      ) : (
        <>
          {/* The scroll flight lands here: Circle of Aloha explainer + video first. */}
          <AlohaCircle />
          <CauseScroller />
          <main>
            <DonationWheel />
            <VisitorTab />
          </main>
        </>
      )}
      <footer>
        <p>The Aloha Circle · Kahului Airport (OGG) · <a href="https://aloha-circle.com">aloha-circle.com</a></p>
        <p className="credit">Background photo: Wailea, Maui by dronepicr (CC BY 2.0)</p>
      </footer>
    </div>
    </div>
    </AuthProvider>
  );
}
