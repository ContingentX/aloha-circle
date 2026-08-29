import { useEffect, useState } from 'react';
import { FEATURED_NONPROFITS } from './nonprofits.js';

// Live Maui signals strip: NWS gridpoint forecast for West Maui (free, CORS
// enabled, no key). Renders nothing weather-wise until the fetch lands; the
// clock ticks regardless so the page always feels live.
export function LiveStrip() {
  const [wx, setWx] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    fetch('https://api.weather.gov/gridpoints/HFO/212,126/forecast')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.properties?.periods?.[0];
        if (p) setWx(p);
      })
      .catch(() => {});
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const hst = now.toLocaleTimeString('en-US', {
    timeZone: 'Pacific/Honolulu',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <p className="live-strip">
      <span className="live-dot" aria-hidden="true" />
      <strong>Maui right now</strong>&nbsp;· {hst} HST
      {wx && (
        <span>
          &nbsp;· {wx.temperature}°{wx.temperatureUnit} · {wx.shortForecast} · winds {wx.windSpeed}
        </span>
      )}
    </p>
  );
}

function CauseModal({ np, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={np.name} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        {np.video ? (
          <video className="modal-media" src={np.video} controls autoPlay playsInline />
        ) : np.image ? (
          <img className="modal-media" src={np.image} alt={np.name} />
        ) : (
          <div className="modal-media cause-art" style={{ background: `linear-gradient(135deg, ${np.grad[0]}, ${np.grad[1]})` }}>
            <span>{np.emoji}</span>
          </div>
        )}
        <h3>{np.name}</h3>
        <p>{np.blurb}</p>
        <p className="hint">🎁 Experience they donate: <strong>{np.experience}</strong></p>
        <p className="tags">{np.causeTags.map((t) => `#${t}`).join(' ')}</p>
        <a className="cta modal-cta" href={np.website} target="_blank" rel="noopener noreferrer">
          Learn more ↗
        </a>
      </div>
    </div>
  );
}

// Horizontally scrolling rail of featured Maui nonprofits. Click a card to
// open the cause modal (founder video when we have one, learn-more link out).
export function CauseScroller() {
  const [open, setOpen] = useState(null);

  return (
    <section className="causes">
      <p className="causes-title">Causes alive on Maui — tap one</p>
      <div className="cause-rail">
        {FEATURED_NONPROFITS.map((np) => (
          <button key={np.id} className="cause-card" onClick={() => setOpen(np)}>
            {np.image ? (
              <img className="cause-thumb" src={np.image} alt="" loading="lazy" />
            ) : (
              <div className="cause-thumb cause-art" style={{ background: `linear-gradient(135deg, ${np.grad[0]}, ${np.grad[1]})` }}>
                <span>{np.emoji}</span>
              </div>
            )}
            {np.video && <span className="cause-play" aria-hidden="true">▶</span>}
            <span className="cause-name">{np.name}</span>
            <span className="cause-tagline">{np.tagline}</span>
          </button>
        ))}
      </div>
      {open && <CauseModal np={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
