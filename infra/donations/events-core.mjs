// Pure logic for the "Happening on Maui" events plane — no AWS, no network,
// no environment reads, so every rule here is unit-testable.
//
// Events are live web findings (Octen search results) published as EVENT#
// records in the shared table. They are a separate entity from CauseSignals:
// a cause belongs to a nonprofit and feeds the matcher's urgency model, while
// an event is something happening on the island that a visitor and a local
// can attend together.
import { createHash } from 'node:crypto';

export const EVENT_TITLE_MAX = 160;
export const EVENT_SUMMARY_MAX = 600;

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const httpsUrl = (value) => {
  const candidate = cleanText(value).slice(0, 2_048);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
  } catch {
    return '';
  }
};

const urlDomain = (value) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isoTimestamp = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

const tagList = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().toLowerCase().slice(0, 32);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length === 12) break;
  }
  return tags;
};

// Stable ID per source URL so each refresh upserts instead of duplicating.
export const eventIdForUrl = (url) =>
  `evt-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

// ---- deterministic event-date extraction ------------------------------------
// Octen returns search results, not structured calendars, so dates come from
// the text itself. The parser is intentionally conservative: a miss renders as
// an undated ("island time") event, a false positive would put a wrong date on
// a card — so only common unambiguous forms are recognised.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const utcDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month, day));
  // Reject overflow (e.g. Feb 31 → Mar 3).
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
};

const isoDay = (date) => date.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

// A date without a year belongs to the occurrence nearest "now": the current
// year, unless that already passed more than ~45 days ago (then next year).
const resolveYearless = (month, day, now) => {
  const candidate = utcDate(now.getUTCFullYear(), month, day);
  if (!candidate) return null;
  if (candidate.getTime() < now.getTime() - 45 * DAY_MS) {
    return utcDate(now.getUTCFullYear() + 1, month, day);
  }
  return candidate;
};

const resolveYear = (rawYear, month, day, now) => {
  if (rawYear === undefined || rawYear === '') return resolveYearless(month, day, now);
  const year = Number(rawYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return utcDate(year, month, day);
};

/**
 * Extract the first recognisable event date (or range) from free text.
 * Returns { startsAt: 'YYYY-MM-DD', endsAt?: 'YYYY-MM-DD' } or null.
 */
export function extractEventDates(text, now = new Date()) {
  const haystack = cleanText(text);
  if (!haystack) return null;

  // ISO form: 2026-11-07
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(haystack);
  // "November 7", "Nov. 7th", "November 7-9", "Nov 7 – Dec 2", "November 7, 2026"
  const monthFirst = new RegExp(
    `\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `(?:\\s*[-–—]\\s*(?:${MONTH_RE}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?` +
    `(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(haystack);
  // "7 November 2026", "7th of November"
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b(?:\\.?,?\\s+(\\d{4}))?`, 'i').exec(haystack);
  // "11/7" or "11/07/2026" (month/day only — rejects 24/7-style idioms)
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(haystack);

  const candidates = [
    [iso, () => {
      const start = utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return start && { start, end: null };
    }],
    [monthFirst, () => {
      const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
      const start = resolveYear(monthFirst[5], month, Number(monthFirst[2]), now);
      if (!start) return null;
      let end = null;
      if (monthFirst[4]) {
        const endMonth = monthFirst[3] ? MONTHS[monthFirst[3].slice(0, 3).toLowerCase()] : month;
        end = utcDate(start.getUTCFullYear(), endMonth, Number(monthFirst[4]));
        if (end && end.getTime() < start.getTime()) {
          end = utcDate(start.getUTCFullYear() + 1, endMonth, Number(monthFirst[4]));
        }
      }
      return { start, end };
    }],
    [dayFirst, () => {
      const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
      const start = resolveYear(dayFirst[3], month, Number(dayFirst[1]), now);
      return start && { start, end: null };
    }],
    [numeric, () => {
      const month = Number(numeric[1]) - 1;
      const day = Number(numeric[2]);
      if (month < 0 || month > 11 || day < 1 || day > 31) return null;
      const start = resolveYear(numeric[3], month, day, now);
      return start && { start, end: null };
    }],
  ];

  let best = null;
  for (const [match, build] of candidates) {
    if (!match) continue;
    const built = build();
    if (!built?.start) continue;
    if (!best || match.index < best.index) best = { index: match.index, ...built };
  }
  if (!best) return null;
  const result = { startsAt: isoDay(best.start) };
  if (best.end && best.end.getTime() >= best.start.getTime()) result.endsAt = isoDay(best.end);
  return result;
}

// ---- normalisation -----------------------------------------------------------

export function validateEventSourceConfig(source) {
  if (!source || typeof source !== 'object') return null;
  const id = cleanText(source.id);
  const query = cleanText(source.octen?.query);
  const causeTags = tagList(source.octen?.causeTags);
  const count = source.octen?.count ?? 10;
  const urgency = source.octen?.urgency ?? 2;
  if (
    !id || !query || causeTags.length === 0 || source.enabled !== true ||
    !Number.isInteger(count) || count < 1 || count > 25 ||
    !Number.isInteger(urgency) || urgency < 1 || urgency > 5
  ) return null;
  const request = { query, count };
  for (const key of ['include_domains', 'exclude_domains', 'include_text', 'exclude_text']) {
    if (Array.isArray(source.octen[key]) && source.octen[key].every((v) => typeof v === 'string')) {
      request[key] = source.octen[key];
    }
  }
  return { id, request, causeTags, urgency };
}

/** Turn one Octen search result into a storable event record body, or null. */
export function toEventRecord(result, { sourceId, causeTags, urgency }, now = new Date()) {
  const title = cleanText(result?.title).slice(0, EVENT_TITLE_MAX);
  const url = httpsUrl(result?.url);
  if (!title || !url) return null;
  const summaryRaw = cleanText(result?.highlight) || title;
  const summary = summaryRaw.length > EVENT_SUMMARY_MAX
    ? `${summaryRaw.slice(0, EVENT_SUMMARY_MAX - 1)}…`
    : summaryRaw;
  const fetchedAt = isoTimestamp(result?.time_last_crawled) ||
    isoTimestamp(result?.time_published) || now.toISOString();
  const dates = extractEventDates(`${title} ${summaryRaw}`, now);
  return {
    entityKind: 'event',
    title,
    summary,
    url,
    domain: urlDomain(url),
    source: sourceId,
    causeTags,
    urgency,
    fetchedAt,
    ...(dates ?? {}),
    status: 'live',
    verified: true,
  };
}

/** Validate a stored record back into the public event-card shape, or null. */
export function toPublicEvent(record) {
  const title = cleanText(record?.title).slice(0, EVENT_TITLE_MAX);
  const summary = cleanText(record?.summary).slice(0, EVENT_SUMMARY_MAX);
  const url = httpsUrl(record?.url);
  const source = cleanText(record?.source).slice(0, 120);
  const fetchedAt = isoTimestamp(record?.fetchedAt);
  const causeTags = tagList(record?.causeTags);
  const id = typeof record?.entityId === 'string' && /^evt-[a-f0-9]{16}$/.test(record.entityId)
    ? record.entityId
    : '';
  if (
    !id || !title || !summary || !url || !source || !fetchedAt ||
    causeTags.length === 0 ||
    record?.status !== 'live' || record?.verified !== true
  ) return null;
  const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  return {
    id,
    title,
    summary,
    url,
    domain: urlDomain(url),
    source,
    causeTags,
    urgency: Number.isInteger(record.urgency) ? Math.min(5, Math.max(1, record.urgency)) : 1,
    fetchedAt,
    startsAt: day(record.startsAt),
    endsAt: day(record.endsAt),
  };
}

/**
 * Listing order for the site: dated upcoming events soonest-first, then
 * undated ("island time") finds freshest-first. Events whose last day is more
 * than one day gone are dropped. `now` should already be Hawaii-shifted —
 * the island decides when "today" ends.
 */
export function sortPublicEvents(events, now = new Date()) {
  const today = isoDay(new Date(now.getTime() - DAY_MS));
  const keep = events.filter((event) => {
    const lastDay = event.endsAt ?? event.startsAt;
    return !lastDay || lastDay >= today;
  });
  const dated = keep.filter((event) => event.startsAt)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const undated = keep.filter((event) => !event.startsAt)
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt) || a.id.localeCompare(b.id));
  return [...dated, ...undated];
}
