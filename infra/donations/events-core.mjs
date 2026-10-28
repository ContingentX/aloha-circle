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

// A date without a year belongs to the occurrence nearest the reference date:
// the reference year, unless that already passed more than ~45 days before it
// (then the next year). The reference is the page's own publication date when
// the provider knows it — "May 31" in a May 2025 article is May 31 2025, not a
// future date — and "now" otherwise.
const resolveYearless = (month, day, reference) => {
  const candidate = utcDate(reference.getUTCFullYear(), month, day);
  if (!candidate) return null;
  if (candidate.getTime() < reference.getTime() - 45 * DAY_MS) {
    return utcDate(reference.getUTCFullYear() + 1, month, day);
  }
  return candidate;
};

// A yearless date this far ahead is more likely a stale page than an upcoming
// event, so it stays undated rather than earning a date badge.
const YEARLESS_MAX_AHEAD_DAYS = 200;

/**
 * Extract the first recognisable event date (or range) from free text.
 * `publishedAt` (the page's own date, when known and not in the future)
 * anchors dates written without a year.
 * Returns { startsAt: 'YYYY-MM-DD', endsAt?: 'YYYY-MM-DD' } or null.
 */
export function extractEventDates(text, now = new Date(), { publishedAt = null } = {}) {
  const haystack = cleanText(text);
  if (!haystack) return null;
  const published = publishedAt ? new Date(publishedAt) : null;
  const reference = published && !Number.isNaN(published.getTime()) && published.getTime() <= now.getTime()
    ? published
    : now;
  const resolveYear = (rawYear, month, day) => {
    if (rawYear === undefined || rawYear === '') {
      const date = resolveYearless(month, day, reference);
      return date && date.getTime() <= now.getTime() + YEARLESS_MAX_AHEAD_DAYS * DAY_MS ? date : null;
    }
    const year = Number(rawYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    return utcDate(year, month, day);
  };

  // ISO form: 2026-11-07
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(haystack);
  // "November 7", "Nov. 7th", "November 7-9", "Nov 7 – Dec 2", "November 7, 2026"
  const monthFirst = new RegExp(
    `\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `(?:\\s*[-–—]\\s*(?:${MONTH_RE}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?` +
    // Search highlights often drop the space after a comma ("Nov 1,2025").
    `(?:(?:,\\s*|\\s+)(\\d{4}))?\\b`, 'i').exec(haystack);
  // "7 November 2026", "7th of November"
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b(?:\\.?(?:,\\s*|\\s+)(\\d{4}))?`, 'i').exec(haystack);
  // "11/7" or "11/07/2026" (month/day only — rejects 24/7-style idioms)
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(haystack);

  const candidates = [
    [iso, () => {
      const start = utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return start && { start, end: null };
    }],
    [monthFirst, () => {
      const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
      const start = resolveYear(monthFirst[5], month, Number(monthFirst[2]));
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
      const start = resolveYear(dayFirst[3], month, Number(dayFirst[1]));
      return start && { start, end: null };
    }],
    [numeric, () => {
      const month = Number(numeric[1]) - 1;
      const day = Number(numeric[2]);
      if (month < 0 || month > 11 || day < 1 || day > 31) return null;
      const start = resolveYear(numeric[3], month, day);
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

// Search highlights arrive with the spaces after punctuation stripped
// ("fans,clear your calendars.Three headliners", "Resorts&Hotels"). Restore
// them for display; periods only before a capital so domains stay intact.
const tidyHighlight = (text) => text
  .replace(/,(?=[A-Za-z])/g, ', ')
  .replace(/([a-z)][.!?;])(?=[A-Z])/g, '$1 ')
  .replace(/([A-Za-z])&(?=[A-Za-z])/g, '$1 & ');

// Pages that say so themselves are not upcoming events.
const PASSED_RE = /\b(?:this )?event has (?:passed|ended)\b/i;
// Search results drift to other islands; a headline about one of them that
// never mentions Maui is not happening on Maui. (Molokaʻi and Lānaʻi are Maui
// County, so they stay.)
const OFF_ISLAND_RE = /\b(?:o[ʻ'‘]?ahu|waik[iī]k[iī]|honolulu|kaua[ʻ'‘]?i|big island|hilo|kona)\b/i;
const isOffIsland = (title) => OFF_ISLAND_RE.test(title) && !/\bmaui\b/i.test(title);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Fill `{month}` / `{next_month}` / `{year}` in a configured query from the
 * island's calendar, so searches ask for what is coming up instead of whatever
 * ranks best from years past. `now` should already be Hawaii-shifted.
 */
export const expandQuery = (query, now = new Date()) =>
  query
    .replaceAll('{month}', MONTH_NAMES[now.getUTCMonth()])
    .replaceAll('{next_month}', MONTH_NAMES[(now.getUTCMonth() + 1) % 12])
    .replaceAll('{year}', String(now.getUTCFullYear()));

/** Turn one Octen search result into a storable event record body, or null. */
export function toEventRecord(result, { sourceId, causeTags, urgency }, now = new Date()) {
  const title = cleanText(result?.title).slice(0, EVENT_TITLE_MAX);
  const url = httpsUrl(result?.url);
  if (!title || !url) return null;
  const summaryRaw = cleanText(result?.highlight) || title;
  const readable = tidyHighlight(summaryRaw);
  const summary = readable.length > EVENT_SUMMARY_MAX
    ? `${readable.slice(0, EVENT_SUMMARY_MAX - 1)}…`
    : readable;
  if (PASSED_RE.test(summaryRaw) || isOffIsland(title)) return null;
  const fetchedAt = isoTimestamp(result?.time_last_crawled) ||
    isoTimestamp(result?.time_published) || now.toISOString();
  const dates = extractEventDates(`${title} ${summaryRaw}`, now, {
    publishedAt: isoTimestamp(result?.time_published) || null,
  });
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
  // The same page often surfaces under several URLs (print views, tracking
  // params, two different searches): one card per headline.
  const seenTitles = new Set();
  return [...dated, ...undated].filter((event) => {
    const key = event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
}
