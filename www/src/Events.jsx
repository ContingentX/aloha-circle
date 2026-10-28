import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

// "Happening on Maui" — live events found on the open web (Octen search →
// EVENT# records → GET /api/events), presented editorially near the bottom of
// the page. Every card links out to its source and carries the product promise:
// pick an event and Aloha Circle matches you with a local to go with.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parseDay = (iso) => {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatDay = (iso) => {
  const date = parseDay(iso);
  if (!date) return null;
  return `${WEEKDAY_SHORT[date.getUTCDay()]}, ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

const formatRange = (startsAt, endsAt) => {
  if (!startsAt) return null;
  if (!endsAt || endsAt === startsAt) return formatDay(startsAt);
  const start = parseDay(startsAt);
  const end = parseDay(endsAt);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTH_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}`;
};

// Search-result headlines carry their publisher ("… : Maui Now",
// "… | Fairmont Kea Lani"). The source domain already shows on the card, so a
// trailing segment that names the site is dropped from the headline.
const siteKey = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
export const cleanTitle = (title, domain = '') => {
  const site = siteKey(domain);
  let clean = title;
  for (let pass = 0; pass < 2; pass += 1) {
    const match = /^(.{12,}?)\s+[|:–—-]\s+([^|:–—]{3,48})$/.exec(clean);
    const key = match ? siteKey(match[2]) : '';
    if (!match || key.length < 4 || !site.includes(key)) break;
    clean = match[1];
  }
  return clean;
};

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const hawaiiToday = () => new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);

function DateBadge({ startsAt, endsAt }) {
  // A range already under way reads "thru <last day>", not a start date that
  // has passed.
  const ongoing = endsAt && startsAt < hawaiiToday() && endsAt >= hawaiiToday();
  const date = parseDay(ongoing ? endsAt : startsAt);
  return (
    <div className="event-date" aria-hidden="true">
      <span className="event-date-month">{ongoing ? 'Thru' : MONTH_SHORT[date.getUTCMonth()]}</span>
      <span className="event-date-day">{date.getUTCDate()}</span>
      <span className="event-date-weekday">
        {ongoing ? MONTH_SHORT[date.getUTCMonth()] : WEEKDAY_SHORT[date.getUTCDay()]}
      </span>
    </div>
  );
}

function GoingNote({ count }) {
  return count > 0 ? (
    <span className="event-going">🤙 {count} local{count === 1 ? '' : 's'} going</span>
  ) : (
    <span className="event-going event-going-open">We'll find you a local</span>
  );
}

function EventCard({ event, featured, onGoWithLocal }) {
  const title = cleanTitle(event.title, event.domain);
  const when = formatRange(event.startsAt, event.endsAt);
  return (
    <article className={featured ? 'event-card event-featured' : 'event-card'}>
      {featured && <span className="event-flag">Coming up next</span>}
      <div className="event-card-main">
        <DateBadge startsAt={event.startsAt} endsAt={event.endsAt} />
        <div className="event-body">
          <p className="event-meta">
            <span className="event-when">{when}</span>
            <span className="event-domain">{event.domain}</span>
          </p>
          <h3 className="event-title">
            <a href={event.url} target="_blank" rel="noopener noreferrer">{title}</a>
          </h3>
          <p className="event-summary">{event.summary}</p>
        </div>
      </div>
      <div className="event-actions">
        <button
          className="cta event-cta"
          onClick={() => onGoWithLocal(event)}
          aria-label={`Go with a local: ${title}`}
        >
          Go with a local
        </button>
        <GoingNote count={event.localsGoing} />
      </div>
    </article>
  );
}

function AnytimeRow({ event, onGoWithLocal }) {
  const title = cleanTitle(event.title, event.domain);
  return (
    <li className="anytime-row">
      <div className="anytime-info">
        <a className="anytime-title" href={event.url} target="_blank" rel="noopener noreferrer">{title}</a>
        <span className="anytime-meta">
          {event.domain}
          {event.localsGoing > 0 && <> · <span className="event-going">🤙 {event.localsGoing} going</span></>}
        </span>
      </div>
      <button
        type="button"
        className="anytime-cta"
        onClick={() => onGoWithLocal(event)}
        aria-label={`Go with a local: ${title}`}
      >
        Go with a local →
      </button>
    </li>
  );
}

export function HappeningOnMaui({ onGoWithLocal }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    api.get('/api/events')
      .then((list) => setEvents(Array.isArray(list) ? list : []))
      .catch(() => setEvents([]));
  }, []);

  // No findings yet (fresh deploy, refresh pending) — say nothing rather than
  // showing an empty news section.
  if (!events || events.length === 0) return null;

  // Dated finds become calendar cards; open-ended ones (volunteer days,
  // standing markets) read better as a compact list than as dateless cards.
  const dated = events.filter((event) => event.startsAt).slice(0, 5);
  const anytime = events.filter((event) => !event.startsAt).slice(0, 6);
  const [lead, ...rest] = dated;

  return (
    <section className="events-section" id="happening" aria-labelledby="happening-title">
      <p className="events-kicker">Live from Maui's calendars</p>
      <h2 className="events-headline" id="happening-title">Happening on Maui</h2>
      <p className="events-deck">
        Don't go alone, and don't go as a tourist. Pick something below and
        Aloha Circle introduces you to a verified local who'd love to go with you.
      </p>
      <ol className="events-steps">
        <li><span>1</span>Pick what calls to you</li>
        <li><span>2</span>We match you with a local who's going</li>
        <li><span>3</span>Experience it together</li>
      </ol>

      {lead && <EventCard event={lead} featured onGoWithLocal={onGoWithLocal} />}
      {rest.length > 0 && (
        <div className="events-grid">
          {rest.map((event) => (
            <EventCard key={event.id} event={event} onGoWithLocal={onGoWithLocal} />
          ))}
        </div>
      )}

      {anytime.length > 0 && (
        <div className="anytime">
          <h3 className="anytime-heading">{dated.length > 0 ? 'Any day on Maui' : 'Ways in, any day'}</h3>
          <ul className="anytime-list">
            {anytime.map((event) => (
              <AnytimeRow key={event.id} event={event} onGoWithLocal={onGoWithLocal} />
            ))}
          </ul>
        </div>
      )}

      <p className="events-footnote">
        Found by live web search and refreshed through the day. Dates come from
        the source page, so confirm with the organizer. Locals choose which
        events they share.
      </p>
    </section>
  );
}

// ---- Local side: opt in to events + see your aloha calendar -------------------

function monthMatrix(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const start = first.getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < start; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const isoFor = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function OptInCalendar({ plans }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState(null);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const plan of plans) {
      if (!plan.startsAt) continue;
      const start = parseDay(plan.startsAt);
      const end = parseDay(plan.endsAt ?? plan.startsAt);
      // Mark every day of a range, capped so a bad range can't paint the year.
      for (let t = start.getTime(), i = 0; t <= end.getTime() && i < 31; t += 86_400_000, i += 1) {
        const iso = new Date(t).toISOString().slice(0, 10);
        if (!map.has(iso)) map.set(iso, []);
        map.get(iso).push(plan);
      }
    }
    return map;
  }, [plans]);

  const cells = monthMatrix(cursor.year, cursor.month);
  const move = (delta) => {
    setSelectedDay(null);
    setCursor(({ year, month }) => {
      const next = new Date(Date.UTC(year, month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };
  const todayIso = isoFor(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedPlans = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <div className="optin-calendar">
      <div className="calendar-head">
        <button type="button" className="link-btn" onClick={() => move(-1)} aria-label="Previous month">←</button>
        <strong>{MONTH_SHORT[cursor.month]} {cursor.year}</strong>
        <button type="button" className="link-btn" onClick={() => move(1)} aria-label="Next month">→</button>
      </div>
      <div className="calendar-grid" role="grid">
        {WEEKDAY_SHORT.map((weekday) => (
          <span key={weekday} className="calendar-weekday">{weekday[0]}</span>
        ))}
        {cells.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} className="calendar-cell" />;
          const iso = isoFor(cursor.year, cursor.month, day);
          const plansToday = byDay.get(iso);
          const classes = ['calendar-cell', 'calendar-day'];
          if (iso === todayIso) classes.push('calendar-today');
          if (plansToday) classes.push('calendar-planned');
          if (iso === selectedDay) classes.push('calendar-selected');
          return (
            <button
              key={iso}
              type="button"
              className={classes.join(' ')}
              onClick={() => setSelectedDay(plansToday ? iso : null)}
              aria-label={plansToday ? `${formatDay(iso)} — ${plansToday.length} planned` : formatDay(iso)}
            >
              {day}
              {plansToday && <span className="calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {selectedPlans.length > 0 && (
        <ul className="calendar-day-list">
          {selectedPlans.map((plan) => (
            <li key={plan.eventId}>
              {plan.url
                ? <a href={plan.url} target="_blank" rel="noopener noreferrer">{cleanTitle(plan.title, domainOf(plan.url))}</a>
                : plan.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocalEventPlanner() {
  const { user, ready, signInWithGoogle } = useAuth();
  const [events, setEvents] = useState([]);
  const [optIns, setOptIns] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    api.get('/api/events')
      .then((list) => setEvents(Array.isArray(list) ? list : []))
      .catch(() => setEvents([]));
    api.get('/local/optins')
      .then((list) => setOptIns(Array.isArray(list) ? list : []))
      .catch((e) => { setOptIns([]); setError(e.message); });
  }, [user]);

  if (!ready) return null;
  if (!user) {
    return (
      <div className="card planner-signin">
        <h3>Take a visitor to something you love</h3>
        <p className="hint">
          Sign in to choose the island events you'd share. Visitors who pick one
          get matched to you, and your aloha calendar keeps track.
        </p>
        <button type="button" className="google-btn" onClick={() => signInWithGoogle().catch(() => {})}>
          Sign in with Google
        </button>
      </div>
    );
  }
  if (optIns === null) return null;

  const going = new Map(optIns.filter((optIn) => optIn.going).map((optIn) => [optIn.eventId, optIn]));

  const toggle = async (event) => {
    setBusyId(event.id);
    setError(null);
    const next = !going.has(event.id);
    try {
      await api.post('/local/optin', { eventId: event.id, going: next });
      setOptIns((prev) => [
        ...prev.filter((optIn) => optIn.eventId !== event.id),
        {
          eventId: event.id, going: next, title: event.title, url: event.url,
          startsAt: event.startsAt, endsAt: event.endsAt, causeTags: event.causeTags,
        },
      ]);
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusyId(null);
    }
  };

  const plans = optIns.filter((optIn) => optIn.going);
  const dated = plans.filter((plan) => plan.startsAt);
  const undated = plans.filter((plan) => !plan.startsAt);

  return (
    <div className="card">
      <div className="planner-head">
        <h3>Events you'd share with a visitor</h3>
        {plans.length > 0 && <span className="planner-count">🤙 {plans.length} going</span>}
      </div>
      <p className="hint">
        Say you're in and visitors who pick that event get matched to you. Your
        calendar below holds everything you've agreed to attend if a visitor
        matches with you.
      </p>
      {events.length === 0 && <p className="hint">No live events found right now — check back soon.</p>}
      <ul className="optin-list">
        {events.map((event) => {
          const isGoing = going.has(event.id);
          const when = formatRange(event.startsAt, event.endsAt);
          return (
            <li key={event.id} className={isGoing ? 'optin-row optin-row-on' : 'optin-row'}>
              <div className="optin-info">
                <strong>{cleanTitle(event.title, event.domain)}</strong>
                <span className="hint">
                  {when ?? 'Any day'} · {event.domain}
                  {event.localsGoing > 0 && ` · ${event.localsGoing} going`}
                </span>
              </div>
              <button
                type="button"
                className={isGoing ? 'optin-toggle optin-on' : 'optin-toggle'}
                disabled={busyId === event.id}
                aria-pressed={isGoing}
                onClick={() => toggle(event)}
              >
                {isGoing ? "✓ I'm in" : '+ Count me in'}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
      {plans.length > 0 && (
        <>
          <h4 className="calendar-title">Your aloha calendar</h4>
          <OptInCalendar plans={dated} />
          {undated.length > 0 && (
            <p className="hint">
              Any day (no set date): {undated.map((plan) => cleanTitle(plan.title, domainOf(plan.url))).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
