export const MAX_REQUEST_BYTES = 32 * 1024;

export class PublicApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
  }
}

export function parseJsonObject(rawBody = '{}') {
  const raw = rawBody ?? '{}';
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
    throw new PublicApiError(413, 'request body is too large');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PublicApiError(400, 'request body must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PublicApiError(400, 'request body must be a JSON object');
  }
  return parsed;
}

const cleanString = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const opaqueId = (value) => {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (candidate.length > 120) return '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(candidate) ? candidate : '';
};

const recordId = (record, prefix) => {
  const explicit = opaqueId(record?.entityId);
  if (explicit) return explicit;
  const expected = `${prefix}#`;
  return typeof record?.PK === 'string' && record.PK.startsWith(expected)
    ? opaqueId(record.PK.slice(expected.length))
    : '';
};

export const isTrustedLocal = (record) =>
  record?.verified === true && record?.status === 'verified';

export const isTrustedEndorsement = (record) =>
  record?.verified === true && record?.status === 'verified';

export const isPublicNonprofit = (record) =>
  record?.verified === true && record?.status === 'verified' &&
  typeof record?.name === 'string' && record.name.trim().length > 0;

export const isPublicCause = (record) =>
  record?.verified === true && record?.status === 'verified';

const stringList = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, 32);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
    if (normalized.length === 12) break;
  }
  return normalized;
};

const httpsUrl = (value) => {
  const candidate = cleanString(value, 2_048);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
  } catch {
    return '';
  }
};

const isoTimestamp = (value) => {
  const candidate = cleanString(value, 40);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) &&
    Number.isFinite(Date.parse(candidate)) ? candidate : '';
};

export function toCauseSignal(record) {
  const id = recordId(record, 'CAUSE');
  const title = cleanString(record?.title, 160);
  const summary = cleanString(record?.summary, 1_000);
  const nonprofit = cleanString(record?.nonprofit, 160);
  const nonprofitId = opaqueId(record?.nonprofitId);
  const causeTags = stringList(record?.causeTags);
  const urgency = record?.urgency;
  const url = httpsUrl(record?.url);
  const source = cleanString(record?.source, 120);
  const fetchedAt = isoTimestamp(record?.fetchedAt);

  if (
    !id || !title || !summary || !nonprofit || !nonprofitId || !url || !source || !fetchedAt ||
    causeTags.length === 0 ||
    !Number.isInteger(urgency) || urgency < 1 || urgency > 5
  ) return null;

  return {
    id,
    source,
    url,
    title,
    causeTags,
    urgency,
    summary,
    fetchedAt,
    nonprofit,
    nonprofitId,
    action: cleanString(record.action, 500) || null,
  };
}

// --- Kiʻi memory → cause-tag derivation --------------------------------------
// aloha-circle lets a signed-in user bring the memories of their conversations
// with Kiʻi (aloha-intelligence.ai) instead of hand-picking interest chips.
// Derivation is deterministic — no LLM: a memory carries a tag when the tag
// itself, or one of its listed synonyms, appears as a whole word in the text.
// Callers pass the tags the current locals/causes actually use as extra
// vocabulary so derived tags always land inside the matcher's overlap space.

export const MEMORY_TAG_SYNONYMS = {
  ocean: ['sea', 'beach', 'beaches', 'shoreline', 'coast', 'coastal', 'marine'],
  reef: ['reefs', 'coral', 'corals'],
  diving: ['dive', 'divers', 'snorkel', 'snorkeling'],
  hiking: ['hike', 'hikes'],
  trails: ['trail'],
  wildlife: [
    'animal', 'animals', 'dog', 'dogs', 'cat', 'cats', 'shelter', 'bird',
    'birds', 'whale', 'whales', 'turtle', 'turtles', 'seal', 'seals', 'humane',
  ],
  farming: [
    'farm', 'farms', 'farmers', 'taro', 'kalo', 'agriculture', 'garden',
    'gardens', 'aina', 'āina', 'ʻāina', 'watershed', 'replanting', 'restoration',
  ],
  cooking: ['cook', 'cooks'],
  community: [
    'ohana', 'ʻohana', 'kupuna', 'kūpuna', 'volunteer', 'volunteers',
    'volunteering', 'clean-up', 'cleanup', 'cleanups',
  ],
  family: ['families', 'keiki'],
  music: ['hula', 'mele'],
  photography: ['photos', 'photographer', 'photograph'],
  'food-security': ['hunger', 'meals', 'pantry', 'food'],
};

export const MEMORY_TEXT_MAX = 400;
export const MEMORY_LIST_MAX = 30;

export const memoryList = (value) => (Array.isArray(value) ? value : [])
  .filter((memory) => typeof memory === 'string' && memory.trim())
  .slice(0, MEMORY_LIST_MAX)
  .map((memory) => memory.trim().slice(0, MEMORY_TEXT_MAX));

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (word, text) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'u').test(text);

export function deriveMemoryTags(memories, vocabulary = []) {
  const texts = memoryList(memories).map((memory) => memory.toLowerCase());
  if (texts.length === 0) return [];

  // Not stringList: the vocabulary is every tag in play, not a 12-chip form.
  const canonicalTags = new Map();
  const vocabularyTags = (Array.isArray(vocabulary) ? vocabulary : [])
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 32))
    .filter(Boolean);
  for (const tag of [...Object.keys(MEMORY_TAG_SYNONYMS), ...vocabularyTags]) {
    const key = tag.toLowerCase();
    if (!canonicalTags.has(key)) canonicalTags.set(key, tag);
  }

  const hits = [];
  for (const [key, tag] of canonicalTags) {
    const words = [key, ...(MEMORY_TAG_SYNONYMS[key] ?? [])];
    const count = texts.filter((text) => words.some((word) => wholeWord(word, text))).length;
    if (count > 0) hits.push({ tag, count });
  }
  hits.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return hits.slice(0, 12).map((hit) => hit.tag);
}

const overlap = (a = [], b = []) => {
  const setB = new Set(stringList(b).map((value) => value.toLowerCase()));
  return stringList(a).filter((value) => setB.has(value.toLowerCase()));
};

const endorsementScore = (cause, endorsements) => {
  const verdictWeight = { helping_now: 2, generally_helping: 1, not_sure: 0, causing_concern: -3 };
  return endorsements
    .filter((endorsement) => (
      cause.nonprofitId && endorsement.nonprofitId
        ? endorsement.nonprofitId === cause.nonprofitId
        : endorsement.nonprofit === cause.nonprofit
    ))
    .reduce((sum, endorsement) => sum + (verdictWeight[endorsement.verdict] ?? 0), 0);
};

const candidateComesFirst = (candidate, current) => {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  const localOrder = candidate.local.id.localeCompare(current.local.id);
  return localOrder < 0 || (localOrder === 0 && candidate.cause.id.localeCompare(current.cause.id) < 0);
};

export function rankMatch(visitor, { locals = [], causes = [], endorsements = [] }) {
  const visitorInterests = stringList(visitor?.interests);
  if (!visitor?.id || !visitor?.name || visitorInterests.length === 0) return null;

  const trustedLocals = locals
    .filter(isTrustedLocal)
    .map((local) => ({ ...local, id: recordId(local, 'LOCAL'), name: cleanString(local.name, 80) }))
    .filter((local) => local.id && local.name);
  const validCauses = causes.filter(isPublicCause).map(toCauseSignal).filter(Boolean);
  const trustedEndorsements = endorsements.filter(isTrustedEndorsement);

  let best = null;
  for (const local of trustedLocals) {
    const sharedInterests = overlap(visitorInterests, local.interests);
    for (const cause of validCauses) {
      const localCauseFit = overlap(local.causes, cause.causeTags);
      const visitorCauseFit = overlap(visitorInterests, cause.causeTags);
      const trust = endorsementScore(cause, trustedEndorsements);
      const score =
        sharedInterests.length * 3 +
        localCauseFit.length * 2 +
        visitorCauseFit.length * 2 +
        cause.urgency +
        Math.min(trust, 5);
      const candidate = {
        local,
        cause,
        sharedInterests,
        score,
        scoreReceipt: {
          sharedInterestCount: sharedInterests.length,
          sharedInterestPoints: sharedInterests.length * 3,
          localCauseOverlapCount: localCauseFit.length,
          localCausePoints: localCauseFit.length * 2,
          visitorCauseOverlapCount: visitorCauseFit.length,
          visitorCausePoints: visitorCauseFit.length * 2,
          urgency: cause.urgency,
          urgencyPoints: cause.urgency,
          endorsementRawScore: trust,
          endorsementPoints: Math.min(trust, 5),
          total: score,
        },
      };
      if (candidateComesFirst(candidate, best)) best = candidate;
    }
  }
  if (!best || best.score <= 0) return null;

  const suggestedAction = best.cause.action ??
    `Ask ${best.local.name} how to help with "${best.cause.title}".`;
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
    localTown: best.local.town ?? null,
    causeId: best.cause.id,
    cause: best.cause.title,
    causeTags: best.cause.causeTags,
    why,
    suggestedAction,
    score: best.score,
    scoreReceipt: best.scoreReceipt,
    blocks: [
      {
        type: 'local', id: best.local.id, name: best.local.name,
        town: best.local.town ?? null, sharedInterests: best.sharedInterests,
      },
      {
        type: 'cause', id: best.cause.id, title: best.cause.title,
        sourceUrl: best.cause.url, fetchedAt: best.cause.fetchedAt,
      },
      { type: 'action', text: suggestedAction },
    ],
  };
}
