import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { cleanTitle, formatRange } from './Events.jsx';

// Event page (/e/<slug-with-date>): everything we found about one island event
// — exact date, summary, source links — plus the coordination layer the match
// promises: a chat where the matched visitor and local find each other, with
// live presence (green = on this page now, grey = seen recently).

const POLL_MS = 10_000;
// A heartbeat lands every poll, so anything older than two polls is "away".
const ONLINE_WINDOW_MS = 25_000;

const hexDigest = async (text) => {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function Avatar({ name, photoURL, size = 32 }) {
  if (photoURL) {
    return <img className="chat-avatar" src={photoURL} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  }
  return (
    <span className="chat-avatar chat-avatar-initial" style={{ width: size, height: size }} aria-hidden="true">
      {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function PresenceRail({ presence, serverNow, myKey }) {
  if (presence.length === 0) {
    return <p className="hint presence-empty">No one is on this page right now — leave a message below and they'll see it.</p>;
  }
  const nowMs = Date.parse(serverNow ?? '') || Date.now();
  return (
    <ul className="presence-rail" aria-label="Who's here">
      {presence.map((person) => {
        const online = nowMs - (Date.parse(person.lastSeenAt ?? '') || 0) < ONLINE_WINDOW_MS;
        return (
          <li key={person.authorKey} className="presence-chip" title={online ? `${person.name} — here now` : `${person.name} — seen recently`}>
            <span className="presence-avatar-wrap">
              <Avatar name={person.name} photoURL={person.photoURL} size={30} />
              <span className={online ? 'presence-dot presence-online' : 'presence-dot presence-away'} aria-hidden="true" />
            </span>
            <span className="presence-name">
              {person.authorKey === myKey ? 'You' : person.name}
              <span className="presence-state">{online ? 'here now' : 'seen recently'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const messageTime = (iso) => {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function ChatMessages({ messages, myKey }) {
  const endRef = useRef(null);
  const count = messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  if (count === 0) {
    return <p className="hint chat-empty">No messages yet. Matched for this event? Say aloha — this is where you plan the meetup.</p>;
  }
  return (
    <ol className="chat-list" aria-live="polite">
      {messages.map((message) => (
        <li key={message.id} className={message.authorKey === myKey ? 'chat-msg chat-mine' : 'chat-msg'}>
          <Avatar name={message.name} photoURL={message.photoURL} />
          <div className="chat-bubble">
            <p className="chat-msg-meta">
              <strong>{message.authorKey === myKey ? 'You' : message.name}</strong>
              <span className="chat-time">{messageTime(message.createdAt)}</span>
            </p>
            <p className="chat-text">{message.text}</p>
          </div>
        </li>
      ))}
      <li ref={endRef} aria-hidden="true" />
    </ol>
  );
}

function EventPageInner({ slug }) {
  const { user, ready, signInWithGoogle } = useAuth();
  const [payload, setPayload] = useState(null); // { event, now, messages, presence }
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myKey, setMyKey] = useState(null);

  // The server identifies chat authors by sha256("firebase:"+uid) — compute the
  // same key locally so "you" styling and the presence rail can self-identify.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setMyKey(null); return undefined; }
    hexDigest(`firebase:${user.uid}`).then((key) => { if (!cancelled) setMyKey(key); });
    return () => { cancelled = true; };
  }, [user]);

  // Poll loop: signed-in visitors heartbeat (POST presence returns the same
  // payload), everyone else reads the public chat. `ready` gates the first
  // call so a returning user's first poll already counts them present.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = user
          ? await api.post(`/api/events/${encodeURIComponent(slug)}/presence`, {})
          : await api.get(`/api/events/${encodeURIComponent(slug)}/chat`);
        if (cancelled) return;
        setPayload(next);
        setError(null);
      } catch (pollError) {
        if (cancelled) return;
        if (/unknown event/i.test(pollError.message)) setNotFound(true);
        else setError('The Aloha Circle API is unreachable right now — retrying.');
      }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [ready, user, slug]);

  const event = payload?.event ?? null;
  const title = useMemo(() => (event ? cleanTitle(event.title, event.domain) : ''), [event]);

  const send = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const { message } = await api.post(`/api/events/${encodeURIComponent(slug)}/chat`, { text });
      setDraft('');
      setPayload((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  if (notFound) {
    return (
      <div className="card">
        <h3>This event page isn't live anymore</h3>
        <p className="hint">
          Events come from live web search and age out once they're long past.
          Head back to <a href="/#happening">Happening on Maui</a> for what's coming up.
        </p>
      </div>
    );
  }
  if (!payload || !event) {
    return <div className="card"><p className="hint">{error ?? 'Loading the event…'}</p></div>;
  }

  const when = formatRange(event.startsAt, event.endsAt);
  return (
    <>
      <article className="card event-hero">
        <p className="event-meta">
          <span className="event-when">{when ?? 'Island time — no set date, confirm with the organizer'}</span>
          <span className="event-domain">{event.domain}</span>
        </p>
        <h2 className="event-page-title">{title}</h2>
        <p className="event-summary">{event.summary}</p>
        <p className="tags">{event.causeTags.map((tag) => `#${tag}`).join(' ')}</p>
        <div className="event-actions">
          <a className="cta event-cta" href={event.url} target="_blank" rel="noopener noreferrer">
            Full details at {event.domain} ↗
          </a>
          <a className="cta event-cta event-cta-secondary" href={`/?e=${event.id}#meet-maui`}>
            Find a local to go with
          </a>
          {event.localsGoing > 0 && (
            <span className="event-going">🤙 {event.localsGoing} local{event.localsGoing === 1 ? '' : 's'} going</span>
          )}
        </div>
        <p className="events-footnote">
          Found by live web search — the date comes from the source page, so confirm with the organizer before you set out.
        </p>
      </article>

      <section className="card chat-card" aria-labelledby="event-chat-title">
        <h3 id="event-chat-title">Meet up & coordinate</h3>
        <p className="hint">
          Matched for this event, or just going? This chat is how you find each
          other — share when you'll arrive and where to meet.
        </p>
        <PresenceRail presence={payload.presence} serverNow={payload.now} myKey={myKey} />
        <ChatMessages messages={payload.messages} myKey={myKey} />
        {user ? (
          <form className="chat-compose" onSubmit={send}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say aloha — e.g. “I'll be by the main entrance at 9, green hat”"
              maxLength={400}
              aria-label="Chat message"
            />
            <button className="cta chat-send" disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        ) : ready && (
          <div className="chat-signin">
            <p className="hint">Sign in to say aloha — your name and icon appear next to your messages.</p>
            <button type="button" className="google-btn" onClick={() => signInWithGoogle().catch(() => {})}>
              Sign in with Google
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </>
  );
}

export function EventPage({ slug }) {
  return (
    <AuthProvider>
      <div className="page event-page">
        <header>
          <div className="header-row">
            <a className="brand-lockup" href="/">
              <img className="brand-logo" src="/aloha-circle-logo.svg" alt="" />
              <h1>Aloha <span className="accent">Circle</span></h1>
            </a>
          </div>
          <p className="tagline"><a href="/#happening">← Happening on Maui</a></p>
        </header>
        <EventPageInner slug={slug} />
        <footer>
          <p>The Aloha Circle · Kahului Airport (OGG) · <a href="https://aloha-circle.com">aloha-circle.com</a></p>
        </footer>
      </div>
    </AuthProvider>
  );
}
