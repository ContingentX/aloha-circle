import { useEffect, useRef, useState } from 'react';
import { appApi } from './appApi.js';
import { useAuth } from './auth.jsx';

// Segment colors cycle around the wheel; the legend chips reuse them by index.
const SEG_COLORS = ['#ff6b57', '#0b5d8a', '#1c7c54', '#e39d25', '#7b5ea7', '#0e8a83'];

const polar = (r, deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
};

// Numbered prize wheel. Purely visual — the /spin outcome is decided
// server-side — so `angle` just accumulates and CSS transitions ease each spin
// to its stop.
function WheelFace({ prizes, angle, duration }) {
  const seg = 360 / prizes.length;
  return (
    <svg className="wheel-svg" viewBox="0 0 200 200" aria-hidden="true">
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: `transform ${duration}s cubic-bezier(0.12, 0.75, 0.18, 1)` }}>
        <circle cx="100" cy="100" r="97" fill="var(--ocean-deep)" />
        {prizes.map((p, i) => {
          const a0 = i * seg;
          const mid = a0 + seg / 2;
          const [x0, y0] = polar(91, a0);
          const [x1, y1] = polar(91, a0 + seg);
          const [tx, ty] = polar(66, mid);
          return (
            <g key={p.id}>
              {prizes.length === 1
                ? <circle cx="100" cy="100" r="91" fill={SEG_COLORS[0]} />
                : <path
                    d={`M100 100 L${x0.toFixed(2)} ${y0.toFixed(2)} A91 91 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`}
                    fill={SEG_COLORS[i % SEG_COLORS.length]} stroke="var(--ocean-deep)" strokeWidth="1.5"
                  />}
              <text className="wheel-num" x={tx.toFixed(2)} y={ty.toFixed(2)} transform={`rotate(${mid} ${tx.toFixed(2)} ${ty.toFixed(2)})`}>
                {i + 1}
              </text>
            </g>
          );
        })}
        <circle cx="100" cy="100" r="13" fill="white" stroke="var(--ocean-deep)" strokeWidth="3" />
      </g>
      <path d="M100 24 L90 3 L110 3 Z" fill="var(--coral)" stroke="white" strokeWidth="2" />
    </svg>
  );
}

// Donation wheel: every active experience is a numbered segment with a legend
// row; picking one sets the donation floor. Payment goes through Stripe
// Checkout; the prize result is decided server-side (/spin) against
// per-day/per-month caps.
export function DonationWheel() {
  const [experiences, setExperiences] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // {won, title, amountUsd}
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [duration, setDuration] = useState(2.4);
  const idleBlocked = useRef(false);
  idleBlocked.current = spinning || !!result;

  useEffect(() => {
    appApi.experiences().then(({ experiences }) => {
      setExperiences(experiences);
      if (experiences[0] && !amount) setAmount(String(experiences[0].minDonation));
    }).catch((e) => setError(e.message));
  }, []);

  // returning from Stripe Checkout: ?spin=cs_...
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('spin');
    if (!sessionId) return;
    setSpinning(true);
    setDuration(2.4);
    setAngle((a) => a + 1440 + Math.floor(Math.random() * 360));
    let cancelled = false;
    // The API answers {pending:true} while a concurrent request holds the spin
    // claim — poll a few times before giving up.
    const poll = (attempt) =>
      appApi.spin(sessionId).then((r) => {
        if (cancelled) return;
        if (r.pending) {
          if (attempt >= 10) throw new Error('Your spin is still processing — refresh to see the result.');
          return new Promise((res) => setTimeout(res, 1500)).then(() => poll(attempt + 1));
        }
        // only forget the session once we have a final result: on failure the
        // ?spin= param stays in the URL so a refresh retries the paid spin
        window.history.replaceState(null, '', window.location.pathname);
        setResult(r);
      });
    poll(0)
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setTimeout(() => setSpinning(false), 2600); });
    return () => { cancelled = true; };
  }, []);

  // attention spins: every few seconds the idle wheel does a lap and eases to
  // a new random stop
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let t;
    const tick = () => {
      if (!idleBlocked.current && document.visibilityState === 'visible') {
        setDuration(2.8);
        setAngle((a) => a + 360 + Math.floor(Math.random() * 360));
      }
      t = setTimeout(tick, 5500 + Math.random() * 3000);
    };
    t = setTimeout(tick, 1500);
    return () => clearTimeout(t);
  }, []);

  const selected = experiences.find((x) => x.id === selectedId) ?? experiences[0];

  const pick = (p) => {
    setSelectedId(p.id);
    setAmount(String(p.minDonation));
  };

  const donate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { url } = await appApi.donate(selected.id, Number(amount));
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (spinning || result) {
    return (
      <div className="card wheel-card">
        <h3>🎡 {spinning ? 'Spinning…' : result?.won ? '🌺 You won!' : '🌊 Mahalo!'}</h3>
        {experiences.length > 0 && <WheelFace prizes={experiences} angle={angle} duration={duration} />}
        {!spinning && result && (
          <p>
            {result.won
              ? <>Your ${result.amountUsd} donation unlocked <strong>{result.title}</strong>! Check your email for details.</>
              : <>Your ${result.amountUsd} donation went straight to the cause — today's experiences were all given out, but your aloha counts double.</>}
          </p>
        )}
        {!spinning && (
          <button className="cta" onClick={() => { setResult(null); }}>Back</button>
        )}
      </div>
    );
  }

  if (!selected) return null;

  return (
    <form className="card wheel-card" onSubmit={donate}>
      <h3>🎡 Donate to win: {selected.title}</h3>
      <p className="hint">
        Every number on the wheel is a real Maui experience donated by a verified nonprofit.
        Pick your prize below, donate its minimum or more, and spin — every dollar goes to the
        cause either way.
      </p>
      <WheelFace prizes={experiences} angle={angle} duration={duration} />
      <ol className="wheel-legend">
        {experiences.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              className={p.id === selected.id ? 'legend-row legend-on' : 'legend-row'}
              aria-pressed={p.id === selected.id}
              onClick={() => pick(p)}
            >
              <span className="legend-num" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }}>{i + 1}</span>
              <span className="legend-text">
                <span>{p.title}</span>
                <span className="legend-meta">${p.value} value · donate ${p.minDonation}+</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <label className="hint" htmlFor="donation-amount">Donation (USD, min ${selected.minDonation})</label>
      <input
        id="donation-amount" type="number" min={selected.minDonation} step="1" value={amount}
        onChange={(e) => setAmount(e.target.value)} required
      />
      <button className="cta" disabled={busy || Number(amount) < selected.minDonation}>
        {busy ? 'Opening checkout…' : `Donate $${amount || selected.minDonation} & spin`}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// Verified nonprofits: offer experiences to the wheel with giveaway caps.
export function ExperienceManager() {
  const { profile } = useAuth();
  const [mine, setMine] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', value: '', minDonation: '', perDay: '1', perMonth: '10' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  const load = () =>
    appApi.experiences().then(({ experiences }) => setMine(experiences.filter((e) => e.npoUid === user?.uid)));
  useEffect(() => { if (user) load().catch(() => {}); }, [user?.uid]);

  if (profile?.role !== 'nonprofit' || profile?.verification?.status !== 'verified') return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await appApi.createExperience({
        title: form.title,
        description: form.description,
        value: Number(form.value),
        minDonation: Number(form.minDonation),
        perDay: Number(form.perDay),
        perMonth: Number(form.perMonth),
      });
      setForm({ title: '', description: '', value: '', minDonation: '', perDay: '1', perMonth: '10' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="card">
      <h3>Your donated experiences</h3>
      <p className="hint">The highest-value experience across all nonprofits headlines the donation wheel; its minimum donation sets the floor.</p>
      {mine.map((x) => (
        <div key={x.id} className="np-row">
          <div><strong>{x.title}</strong><span className="hint"> · ${x.value} value · ${x.minDonation} min · {x.perDay}/day · {x.perMonth}/mo</span></div>
        </div>
      ))}
      <form onSubmit={submit}>
        <input placeholder="Experience title (Sunset sail for two)" value={form.title} onChange={set('title')} required />
        <input placeholder="Short description" value={form.description} onChange={set('description')} />
        <div className="field-row">
          <input type="number" min="1" placeholder="Value $" value={form.value} onChange={set('value')} required />
          <input type="number" min="1" placeholder="Min donation $" value={form.minDonation} onChange={set('minDonation')} required />
          <input type="number" min="0" placeholder="Per day" title="Max per day" value={form.perDay} onChange={set('perDay')} required />
          <input type="number" min="0" placeholder="Per month" title="Max per month" value={form.perMonth} onChange={set('perMonth')} required />
        </div>
        <button className="cta" disabled={busy}>{busy ? 'Adding…' : 'Offer experience'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
