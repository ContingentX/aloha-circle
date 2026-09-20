import { useEffect, useState } from 'react';
import { api } from './api.js';
import { KII_HOME, completeMaskyCallback, maskyLogin } from './kii.js';

const AGENT_CONSOLE_URL = import.meta.env.VITE_AGENT_CONSOLE_URL ?? '/agent-console';

export function MatchCard({ match, agent }) {
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

// Match from your kiʻi conversations: identify as a local or a traveller,
// sign in with Masky, and the causes you talked about with Kiʻi on
// aloha-intelligence.ai become your matcher input — no interest chips needed.
export function KiiMatch() {
  const [role, setRole] = useState(null); // 'traveller' | 'local'
  const [phase, setPhase] = useState('idle'); // idle | working | matched | registered
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let callback;
      try {
        callback = await completeMaskyCallback();
      } catch (callbackError) {
        if (!cancelled) setError(callbackError.message);
        return;
      }
      if (!callback || cancelled) return;
      setRole(callback.role);
      setPhase('working');
      try {
        if (callback.memories.length === 0) {
          throw new Error(
            'Kiʻi has no memories of you yet — have a conversation with the ancestors first.',
          );
        }
        const name = callback.name || 'Aloha friend';
        if (callback.role === 'local') {
          const local = await api.post('/api/locals', { name, memories: callback.memories });
          if (cancelled) return;
          setResult(local);
          setPhase('registered');
        } else {
          const visitor = await api.post('/api/visitors', { name, memories: callback.memories });
          if (cancelled) return;
          if (!visitor.match) {
            throw new Error('No eligible Maui match is available for your causes yet — check back soon.');
          }
          setResult(visitor);
          setPhase('matched');
        }
      } catch (matchError) {
        if (cancelled) return;
        setError(matchError.message);
        setPhase('idle');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (phase === 'matched') {
    return (
      <div>
        <MatchCard match={result.match} />
        {result.derivedInterests?.length > 0 && (
          <p className="hint">
            From your kiʻi conversations: {result.derivedInterests.map((tag) => `#${tag}`).join(' ')}
          </p>
        )}
      </div>
    );
  }

  if (phase === 'registered') {
    return (
      <div className="card">
        <h3>Mahalo, {result.name}! Your local profile is pending verification.</h3>
        <p className="hint">
          Causes from your kiʻi conversations: {(result.derivedInterests ?? []).map((tag) => `#${tag}`).join(' ') || 'none yet'}.
          Once you are verified, travellers who care about the same causes will be matched to you.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Match from your conversations with the ancestors</h3>
      <p className="hint">
        Talked with Kiʻi on <a href={KII_HOME} target="_blank" rel="noreferrer">aloha-intelligence.ai</a>?
        Sign in with the same Masky account and the causes you shared become your match —
        your digital clone meets Maui for you. First, which are you?
      </p>
      <div className="chips">
        <button
          type="button"
          className={role === 'traveller' ? 'chip chip-on' : 'chip'}
          onClick={() => setRole('traveller')}
        >
          I'm a traveller
        </button>
        <button
          type="button"
          className={role === 'local' ? 'chip chip-on' : 'chip'}
          onClick={() => setRole('local')}
        >
          I'm a local
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button
        className="cta"
        disabled={!role || phase === 'working'}
        onClick={() => maskyLogin(role)}
      >
        {phase === 'working' ? 'Reading your kiʻi memories…' : 'Continue with Masky'}
      </button>
      <p className="hint">Prefer to pick by hand? Use the form below.</p>
    </div>
  );
}
