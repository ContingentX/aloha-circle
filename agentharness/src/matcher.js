// Deterministic matcher: visitor × local × cause → match with a human "why".
// This is the seam the TrueForge agent (Local Scout / Cause Scout / Experience
// Scout subagents) replaces in phase 2 — same inputs, same Match shape out.
import { load, insert } from './store.js';

function overlap(a = [], b = []) {
  const setB = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => setB.has(x.toLowerCase()));
}

function endorsementScore(nonprofitName, endorsements) {
  const verdictWeight = { helping_now: 2, generally_helping: 1, not_sure: 0, causing_concern: -3 };
  return endorsements
    .filter((e) => e.nonprofit === nonprofitName)
    .reduce((sum, e) => sum + (verdictWeight[e.verdict] ?? 0), 0);
}

export function matchVisitor(visitor) {
  const locals = load('locals');
  const causes = load('causes');
  const endorsements = load('endorsements');

  let best = null;
  for (const local of locals) {
    const sharedInterests = overlap(visitor.interests, local.interests);
    for (const cause of causes) {
      const localCauseFit = overlap(local.causes, cause.causeTags);
      const visitorCauseFit = overlap(visitor.interests, cause.causeTags);
      const trust = endorsementScore(cause.nonprofit, endorsements);
      const score =
        sharedInterests.length * 3 +
        localCauseFit.length * 2 +
        visitorCauseFit.length * 2 +
        (cause.urgency ?? 0) +
        Math.min(trust, 5);
      if (!best || score > best.score) {
        best = { local, cause, sharedInterests, score };
      }
    }
  }
  if (!best || best.score <= 0) return null;

  const why = [
    best.sharedInterests.length
      ? `You and ${best.local.name} both care about ${best.sharedInterests.join(' and ')}.`
      : `${best.local.name} knows this cause well.`,
    best.cause.summary,
  ].join(' ');

  return insert('matches', {
    visitorId: visitor.id,
    visitorName: visitor.name,
    localId: best.local.id,
    localName: best.local.name,
    localTown: best.local.town,
    cause: best.cause.title,
    causeTags: best.cause.causeTags,
    why,
    suggestedAction: best.cause.action ?? `Ask ${best.local.name} how to help with "${best.cause.title}".`,
    score: best.score,
  });
}
