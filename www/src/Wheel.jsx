import { useEffect, useState } from 'react';
import { appApi } from './appApi.js';
import { useAuth } from './auth.jsx';

// Donation wheel: advertises the highest-value active experience; its
// minDonation sets the floor. Payment goes through Stripe Checkout; the prize
// result is decided server-side (/spin) against per-day/per-month caps.
export function DonationWheel() {
  const [experiences, setExperiences] = useState([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // {won, title, amountUsd}
  const [spinning, setSpinning] = useState(false);

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
    window.history.replaceState(null, '', window.location.pathname);
    setSpinning(true);
    appApi.spin(sessionId)
      .then((r) => setResult(r))
      .catch((e) => setError(e.message))
      .finally(() => setTimeout(() => setSpinning(false), 2600));
  }, []);

  const top = experiences[0];

  const donate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { url } = await appApi.donate(top.id, Number(amount));
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
        <div className={spinning ? 'wheel wheel-spin' : 'wheel'} aria-hidden="true" />
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

  if (!top) return null;

  return (
    <form className="card wheel-card" onSubmit={donate}>
      <h3>🎡 Donate &amp; spin for: {top.title}</h3>
      <p className="hint">
        {top.description} Donate ${top.minDonation}+ to a verified Maui cause for a chance to unlock it
        (worth ${top.value}). Every dollar goes to the cause either way.
      </p>
      <div className="wheel" aria-hidden="true" />
      <label className="hint" htmlFor="donation-amount">Donation (USD, min ${top.minDonation})</label>
      <input
        id="donation-amount" type="number" min={top.minDonation} step="1" value={amount}
        onChange={(e) => setAmount(e.target.value)} required
      />
      <button className="cta" disabled={busy || Number(amount) < top.minDonation}>
        {busy ? 'Opening checkout…' : `Donate $${amount || top.minDonation} & spin`}
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
