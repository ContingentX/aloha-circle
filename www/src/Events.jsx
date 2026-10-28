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

function DateBadge({ startsAt }) {
  const date = parseDay(startsAt);
  if (!date) {
    return (
      <div className="event-date event-date-open" aria-label="No fixed date">
        <span className="event-date-month">Island</span>
        <span className="event-date-day">time</span>
      </div>
    );
  }
  return (
    <div className="event-date">
      <span className="event-date-month">{MONTH_SHORT[date.getUTCMonth()]}</span>
      <span className="event-date-day">{date.getUTCDate()}</span>
      <span className="event-date-weekday">{WEEKDAY_SHORT[date.getUTCDay()]}</span>
    </div>
  );
}

function EventCard({ event, featured, onGoWithLocal }) {
  const when = formatRange(event.startsAt, event.endsAt);
  return (
    <article className={featured ? 'event-card event-featured' : 'event-card'}>
      <DateBadge startsAt={event.startsAt} />
      <div className="event-body">
        <p className="event-meta">
          <span className="event-domain">{event.domain}</span>
          {when && <span className="event-when"> · {when}</span>}
          {event.localsGoing > 0 && (
            <span className="event-going"> · 🤙 {event.localsGoing} local{event.localsGoing === 1 ? '' : 's'} ready to go</span>
          )}
        </p>
        <h3 className="event-title">{event.title}</h3>
        <p className="event-summary">{event.summary}</p>
        <p className="tags">{event.causeTags.map((tag) => `#${tag}`).join(' ')}</p>
        <div className="event-actions">
          <button className="cta event-cta" onClick={() => onGoWithLocal(event)}>
            Go with a local
          </button>
          <a className="event-link" href={event.url} target="_blank" rel="noopener noreferrer">
            Event details ↗
          </a>
        </div>
      </div>
    </article>
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

  const [lead, ...rest] = events;

  return (
    <section className="events-section" id="happening">
      <p className="events-kicker">Live from the open web</p>
      <h2 className="events-headline">Happening on Maui</h2>
      <p className="events-deck">
        Real events and gatherings, found across the island's calendars and
        refreshed through the day. Pick one that calls to you — Aloha Circle
        introduces you to a <strong>verified local</strong> who will experience
        it with you, not just point the way.
      </p>
      <EventCard event={lead} featured onGoWithLocal={onGoWithLocal} />
      {rest.length > 0 && (
        <div className="events-grid">
          {rest.slice(0, 8).map((event) => (
            <EventCard key={event.id} event={event} onGoWithLocal={onGoWithLocal} />
          ))}
        </div>
      )}
      <p className="events-footnote">
        Found by live web search · dates are read from the source page, so
        confirm with the organizer · locals choose which events they share.
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
              {plan.url ? <a href={plan.url} target="_blank" rel="noopener noreferrer">{plan.title}</a> : plan.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocalEventPlanner() {
  const { user, ready } = useAuth();
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

  if (!ready || !user || optIns === null) return null;

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
      <h3>Events you'd share with a visitor</h3>
      <p className="hint">
        Opt in to what's happening and visitors who pick that event get matched
        to you. Your calendar below shows everything you've agreed to attend if
        a visitor matches with you.
      </p>
      {events.length === 0 && <p className="hint">No live events found right now — check back soon.</p>}
      <ul className="optin-list">
        {events.map((event) => {
          const isGoing = going.has(event.id);
          const when = formatRange(event.startsAt, event.endsAt);
          return (
            <li key={event.id} className="optin-row">
              <div className="optin-info">
                <strong>{event.title}</strong>
                <span className="hint">
                  {when ?? 'island time'} · {event.domain}
                  {event.localsGoing > 0 && ` · ${event.localsGoing} going`}
                </span>
              </div>
              <button
                type="button"
                className={isGoing ? 'optin-toggle optin-on' : 'optin-toggle'}
                disabled={busyId === event.id}
                onClick={() => toggle(event)}
              >
                {isGoing ? "🤙 I'm in" : "I'd go"}
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
              Island time (no set date): {undated.map((plan) => plan.title).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
