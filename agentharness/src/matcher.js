// Deterministic matcher: visitor × local × cause → match with a human "why".
// All state is passed explicitly so the scorer stays pure and independently testable.

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

function assertCauseSignal(cause) {
  if (!cause || typeof cause !== 'object') throw new TypeError('cause must be an object');
  for (const field of ['id', 'title', 'summary', 'nonprofit']) {
    if (typeof cause[field] !== 'string' || cause[field].trim() === '') {
      throw new TypeError(`cause.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(cause.causeTags) || cause.causeTags.some((tag) => typeof tag !== 'string' || tag === '')) {
    throw new TypeError('cause.causeTags must be an array of non-empty strings');
  }
  if (!Number.isInteger(cause.urgency) || cause.urgency < 1 || cause.urgency > 5) {
    throw new TypeError('cause.urgency must be an integer from 1 through 5');
  }
}

export function rankMatch(visitor, { locals, causes, endorsements }) {
  if (!visitor || !Array.isArray(visitor.interests)) throw new TypeError('visitor.interests must be an array');
  if (!Array.isArray(locals) || !Array.isArray(causes) || !Array.isArray(endorsements)) {
    throw new TypeError('locals, causes, and endorsements must be arrays');
  }
  causes.forEach(assertCauseSignal);

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

  return {
    visitorId: visitor.id,
    visitorName: visitor.name,
    localId: best.local.id,
    localName: best.local.name,
    localTown: best.local.town,
    causeId: best.cause.id,
    cause: best.cause.title,
    causeTags: best.cause.causeTags,
    why,
    suggestedAction: best.cause.action ?? `Ask ${best.local.name} how to help with "${best.cause.title}".`,
    score: best.score,
    blocks: [
      {
        type: 'local',
        id: best.local.id,
        name: best.local.name,
        town: best.local.town,
        sharedInterests: best.sharedInterests,
      },
      {
        type: 'cause',
        id: best.cause.id,
        title: best.cause.title,
        sourceUrl: best.cause.url,
        fetchedAt: best.cause.fetchedAt,
      },
      { type: 'action', text: best.cause.action ?? `Ask ${best.local.name} how to help with "${best.cause.title}".` },
    ],
  };
}
