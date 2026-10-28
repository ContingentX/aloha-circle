import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articleDateFromUrl,
  eventIdForUrl,
  expandQuery,
  extractEventDates,
  isAggregatorPage,
  sortPublicEvents,
  toEventRecord,
  toPublicEvent,
  validateEventSourceConfig,
} from './events-core.mjs';
import { createEventsPlane, loadEventSources } from './events.mjs';
import { createPublicApi } from './public-api.mjs';

const NOW = new Date('2026-10-28T02:00:00.000Z');

class PutCommand { constructor(input) { this.input = input; } }
class ScanCommand { constructor(input) { this.input = input; } }
class QueryCommand { constructor(input) { this.input = input; } }

// ---- date extraction ----------------------------------------------------------

test('extractEventDates reads a year even when the comma has no space after it', () => {
  // Real Octen highlight shape: a 2025 fundraiser must not turn into a 2026 date.
  assert.deepEqual(
    extractEventDates('Tree of Hope Fundraiser Event Date: Nov 1,2025 – Dec 31,2025', NOW),
    { startsAt: '2025-11-01' },
  );
  assert.deepEqual(extractEventDates('Planting 8 November,2025 upcountry', NOW), { startsAt: '2025-11-08' });
});

test('extractEventDates anchors yearless dates to the page publication date', () => {
  // A May 2025 article about "May 31" is about May 31 2025, not a future May.
  assert.deepEqual(
    extractEventDates('Kicks off May 31 at Kaanapali', NOW, { publishedAt: '2025-05-30T00:00:00.000Z' }),
    { startsAt: '2025-05-31' },
  );
  // A future or missing publication date falls back to now.
  assert.deepEqual(
    extractEventDates('Maui County Fair November 7', NOW, { publishedAt: '2030-01-01T00:00:00.000Z' }),
    { startsAt: '2026-11-07' },
  );
});

test('extractEventDates leaves far-off yearless dates undated', () => {
  // October 28 now: "July 24" without a year is a stale page, not a date 9 months out.
  assert.equal(extractEventDates('Featured events July 24 at the MACC', NOW), null);
  // An explicit year far ahead is still trusted.
  assert.deepEqual(extractEventDates('Concert April 29, 2027 at the MACC', NOW), { startsAt: '2027-04-29' });
});

test('expandQuery fills month tokens from the given (Hawaii) calendar', () => {
  assert.equal(
    expandQuery('Maui events {month} {next_month} {year}', new Date('2026-12-15T00:00:00.000Z')),
    'Maui events December January 2026',
  );
  assert.equal(expandQuery('no tokens here', NOW), 'no tokens here');
});

test('toEventRecord drops passed and off-island pages and tidies highlights', () => {
  const source = { sourceId: 's', causeTags: ['events'], urgency: 2 };
  assert.equal(toEventRecord({
    title: 'Maui Tree Planting', url: 'https://dlnr.test/plant',
    highlight: 'This event has passed. Maui Tree Planting November 8,2025',
  }, source, NOW), null);
  assert.equal(toEventRecord({
    title: "Movies, music and more: your guide to the weekend on Oʻahu", url: 'https://news.test/oahu',
    highlight: 'Things to do.',
  }, source, NOW), null);
  assert.ok(toEventRecord({
    title: 'Scholarships help Maui farmers attend a convention on Oʻahu', url: 'https://news.test/hfu',
    highlight: 'Farmers.',
  }, source, NOW));
  const tidy = toEventRecord({
    title: 'October on Maui', url: 'https://blog.test/october',
    highlight: 'Reggae fans,clear your calendars.Three headliners land.Outrigger Resorts&Hotels at maui.surfrider.org',
  }, source, NOW);
  assert.equal(
    tidy.summary,
    'Reggae fans, clear your calendars. Three headliners land. Outrigger Resorts & Hotels at maui.surfrider.org',
  );
});

test('sortPublicEvents keeps one card per headline', () => {
  const base = {
    summary: 's', source: 'x', causeTags: ['events'], urgency: 2,
    fetchedAt: '2026-10-27T00:00:00.000Z', startsAt: null, endsAt: null,
  };
  const sorted = sortPublicEvents([
    { ...base, id: 'evt-1', title: 'GUIDE: Maui night markets' },
    { ...base, id: 'evt-2', title: 'Guide — Maui night markets!' },
    { ...base, id: 'evt-3', title: 'Something else' },
  ], NOW);
  assert.deepEqual(sorted.map((event) => event.id), ['evt-1', 'evt-3']);
});

test('extractEventDates reads common forms and resolves missing years forward', () => {
  assert.deepEqual(extractEventDates('Maui County Fair November 7', NOW), { startsAt: '2026-11-07' });
  assert.deepEqual(extractEventDates('Nov. 7th craft fair in Wailuku', NOW), { startsAt: '2026-11-07' });
  assert.deepEqual(
    extractEventDates('Festivals of Aloha Nov 7-9 in Hana', NOW),
    { startsAt: '2026-11-07', endsAt: '2026-11-09' },
  );
  assert.deepEqual(
    extractEventDates('Runs November 28 – December 2 at the MACC', NOW),
    { startsAt: '2026-11-28', endsAt: '2026-12-02' },
  );
  assert.deepEqual(extractEventDates('Workshop on 2026-12-05 at UH Maui', NOW), { startsAt: '2026-12-05' });
  assert.deepEqual(extractEventDates('Beach cleanup 11/14 at Baldwin', NOW), { startsAt: '2026-11-14' });
  assert.deepEqual(extractEventDates('Gala on 7 November 2026', NOW), { startsAt: '2026-11-07' });
  // A yearless date months in the past belongs to next year.
  assert.deepEqual(extractEventDates('Whale festival February 14', NOW), { startsAt: '2027-02-14' });
  // A date a few weeks back stays in the current year (event just happened).
  assert.deepEqual(extractEventDates('Recap: October 4 fair', NOW), { startsAt: '2026-10-04' });
});

test('extractEventDates resolves weekday words against the publication date', () => {
  // The real shape that leaked into "Any day on Maui": a news blurb that only
  // says "Saturday". Published Friday Oct 9 → Saturday Oct 10 (now past).
  assert.deepEqual(
    extractEventDates('22nd Annual Lāhainā Town Cleanup rescheduled for Saturday', NOW,
      { publishedAt: '2026-10-09T18:00:00.000Z' }),
    { startsAt: '2026-10-10' },
  );
  // Without a trusted publication date the weekday stays unresolved — crawl
  // time would invent a future date for an old article.
  assert.equal(extractEventDates('Cleanup rescheduled for Saturday', NOW), null);
  // Recurring gatherings are not anchored to the article's news cycle.
  assert.equal(
    extractEventDates('Upcountry farmers market every Saturday', NOW, { publishedAt: '2026-10-09T00:00:00.000Z' }),
    null,
  );
  assert.deepEqual(
    extractEventDates('Reef talk tomorrow at the aquarium', NOW, { publishedAt: '2026-10-26T08:00:00.000Z' }),
    { startsAt: '2026-10-27' },
  );
  assert.deepEqual(
    extractEventDates('Keiki fishing derby this weekend', NOW, { publishedAt: '2026-10-26T08:00:00.000Z' }),
    { startsAt: '2026-10-31', endsAt: '2026-11-01' },
  );
  // An explicit date still wins over the weekday word.
  assert.deepEqual(
    extractEventDates('Cleanup moved to Saturday, Oct. 10, from Sept. 26', NOW,
      { publishedAt: '2026-10-09T00:00:00.000Z' }),
    { startsAt: '2026-10-10' },
  );
});

test('articleDateFromUrl reads news-article date paths', () => {
  const day = articleDateFromUrl('https://mauinow.test/2026/10/09/22nd-annual-lahaina-town-cleanup/');
  assert.equal(new Date(day.startMs).toISOString().slice(0, 10), '2026-10-09');
  assert.equal(day.lastMs, day.startMs);
  const month = articleDateFromUrl('https://mauinews.test/news/local-news/2026/10/cleanup-rescheduled/');
  assert.equal(new Date(month.startMs).toISOString().slice(0, 10), '2026-10-01');
  assert.equal(new Date(month.lastMs).toISOString().slice(0, 10), '2026-10-31');
  assert.equal(articleDateFromUrl('https://x.test/photos/2026/13/bad-month/'), null);
  assert.equal(articleDateFromUrl('https://x.test/volunteer'), null);
});

test('isAggregatorPage flags calendars, guides and listing pages, not single events', () => {
  // Pages about events, not events.
  assert.ok(isAggregatorPage('Maui Events Calendar', 'https://mauinow.test/calendar/'));
  assert.ok(isAggregatorPage('Calendar • Maui County', 'https://mauicounty.test/calendar.aspx'));
  assert.ok(isAggregatorPage('Maui Events November 2026: festivals, concerts and more', 'https://blog.test/post'));
  assert.ok(isAggregatorPage('Things to do on Maui this fall', 'https://news.test/story'));
  assert.ok(isAggregatorPage('Upcoming events', 'https://venue.test/about'));
  assert.ok(isAggregatorPage('MACC happenings', 'https://macc.test/events/'));
  // Live leaks from the first cleaned refresh: a news podcast episode and a
  // news-site category archive are not attendable either.
  assert.ok(isAggregatorPage(
    'Oct. 26, 2026: Island flood threat - Hawaii Travel Daily',
    'https://podcasts.apple.com/us/podcast/oct-26-2026-island-flood-threat/id123?i=456',
  ));
  assert.ok(isAggregatorPage('Maui Arts & Entertainment : Maui Now', 'https://mauinow.com/category/maui-arts-entertainment/'));
  // Single events survive, including event pages under a listing path.
  assert.ok(!isAggregatorPage('Made in Maui County Festival', 'https://festival.test/schedule'));
  assert.ok(!isAggregatorPage('Earth Wind & Fire at the MACC', 'https://macc.test/events/earth-wind-and-fire'));
  assert.ok(!isAggregatorPage('Community cleanup', 'https://mauicounty.test/calendar.aspx?EID=12345'));
  assert.ok(!isAggregatorPage('Volunteer with the watershed crew', 'https://kealani.test/volunteer'));
});

test('toEventRecord and toPublicEvent drop aggregator pages, retroactively too', () => {
  const source = { sourceId: 's', causeTags: ['events'], urgency: 2 };
  assert.equal(toEventRecord({
    title: 'Maui Events November 2026', url: 'https://blog.test/maui-events',
    highlight: 'All the festivals this month.',
  }, source, NOW), null);
  // A record stored before the filter existed stops being served.
  const stored = {
    ...toEventRecord({
      title: 'Harvest festival December 5', url: 'https://farm.test/harvest', highlight: 'Music and food.',
    }, source, NOW),
    entityId: eventIdForUrl('https://farm.test/harvest'),
  };
  assert.ok(toPublicEvent(stored));
  assert.equal(toPublicEvent({ ...stored, title: 'Maui events calendar' }), null);
});

test('sortPublicEvents drops undated cards that are stale news, keeps evergreen finds', () => {
  const base = {
    summary: 's', source: 'x', causeTags: ['events'], urgency: 2,
    fetchedAt: '2026-10-27T00:00:00.000Z', startsAt: null, endsAt: null, domain: 'x.test',
  };
  const sorted = sortPublicEvents([
    // Weekday-anchored headline the parser could not date: not "any day".
    { ...base, id: 'evt-1', title: 'Cleanup rescheduled for Saturday', url: 'https://news.test/cleanup' },
    // Article URL dated 18 days before now: stale coverage, not an invitation.
    { ...base, id: 'evt-2', title: 'Keiki day at the aquarium', url: 'https://news.test/2026/10/09/keiki-day/' },
    // Fresh article URL: stays.
    { ...base, id: 'evt-3', title: 'New moonlight paddle series', url: 'https://news.test/2026/10/25/paddle/' },
    // Evergreen volunteer page with no date anywhere: stays.
    { ...base, id: 'evt-4', title: 'Volunteer with the watershed crew', url: 'https://crew.test/volunteer' },
    // Recurring weekly gathering: "Saturdays" is not a news anchor.
    { ...base, id: 'evt-5', title: 'Farmers market Saturdays in Pukalani', url: 'https://market.test/info' },
  ], NOW);
  assert.deepEqual(sorted.map((event) => event.id), ['evt-3', 'evt-4', 'evt-5']);
});

test('sortPublicEvents folds two outlets covering the same event into one card', () => {
  const base = {
    summary: 's', source: 'x', causeTags: ['events'], urgency: 2,
    fetchedAt: '2026-10-27T00:00:00.000Z', domain: 'x.test',
  };
  const sorted = sortPublicEvents([
    { ...base, id: 'evt-1', title: 'Lahaina Town Cleanup set for November 14', url: 'https://a.test/1', startsAt: '2026-11-14', endsAt: null },
    { ...base, id: 'evt-2', title: '22nd Annual Lāhainā Town Cleanup set for November 14 | Maui Now', url: 'https://b.test/2', startsAt: '2026-11-14', endsAt: null },
    { ...base, id: 'evt-3', title: 'Honokōwai reef day', url: 'https://c.test/3', startsAt: '2026-11-20', endsAt: null },
  ], NOW);
  assert.deepEqual(sorted.map((event) => event.id), ['evt-1', 'evt-3']);
});

test('extractEventDates stays conservative: idioms and junk produce no date', () => {
  assert.equal(extractEventDates('Hotline open 24/7 for visitors', NOW), null);
  assert.equal(extractEventDates('Top 10 things to do on Maui', NOW), null);
  assert.equal(extractEventDates('February 31 never happens', NOW), null);
  assert.equal(extractEventDates('', NOW), null);
});

// ---- normalisation ------------------------------------------------------------

const SOURCE = { sourceId: 'octen-maui-happenings', causeTags: ['events', 'community'], urgency: 2 };

test('toEventRecord normalises an Octen result with provenance and extracted dates', () => {
  const record = toEventRecord({
    title: '  Maui County Fair \n returns November 7-9  ',
    url: 'https://www.mauicountyfair.com/schedule',
    highlight: 'Rides, livestock, and local food booths all weekend.',
    time_last_crawled: '2026-10-27T18:00:00Z',
  }, SOURCE, NOW);
  assert.equal(record.title, 'Maui County Fair returns November 7-9');
  assert.equal(record.domain, 'mauicountyfair.com');
  assert.equal(record.startsAt, '2026-11-07');
  assert.equal(record.endsAt, '2026-11-09');
  assert.equal(record.fetchedAt, '2026-10-27T18:00:00.000Z');
  assert.deepEqual(record.causeTags, ['events', 'community']);
  assert.equal(record.status, 'live');
  assert.equal(record.verified, true);
});

test('toEventRecord rejects non-https results and falls back to an undated card', () => {
  assert.equal(toEventRecord({ title: 'x', url: 'http://insecure.test/' }, SOURCE, NOW), null);
  const undated = toEventRecord({
    title: 'Volunteer with the humane society',
    url: 'https://hawaiianhumane.test/volunteer',
  }, SOURCE, NOW);
  assert.equal(undated.startsAt, undefined);
  assert.equal(undated.summary, 'Volunteer with the humane society');
});

test('toPublicEvent validates stored records and drops tampered ones', () => {
  const stored = {
    ...toEventRecord({
      title: 'Lahaina replanting day December 5',
      url: 'https://mauinow.test/replant',
      highlight: 'Join the watershed crew.',
    }, SOURCE, NOW),
    entityId: eventIdForUrl('https://mauinow.test/replant'),
  };
  const card = toPublicEvent(stored);
  assert.equal(card.startsAt, '2026-12-05');
  assert.equal(card.domain, 'mauinow.test');
  assert.equal(toPublicEvent({ ...stored, verified: false }), null);
  assert.equal(toPublicEvent({ ...stored, entityId: 'not-an-event-id' }), null);
});

test('sortPublicEvents puts dated upcoming first, keeps ranges in progress, drops the past', () => {
  const event = (id, extra) => ({
    id, title: id, summary: id, url: `https://x.test/${id}`, domain: 'x.test',
    source: 's', causeTags: ['events'], urgency: 2,
    fetchedAt: '2026-10-27T00:00:00.000Z', startsAt: null, endsAt: null, ...extra,
  });
  const sorted = sortPublicEvents([
    event('undated-old', { fetchedAt: '2026-10-20T00:00:00.000Z' }),
    event('past', { startsAt: '2026-10-01' }),
    event('running-range', { startsAt: '2026-10-20', endsAt: '2026-11-01' }),
    event('soon', { startsAt: '2026-11-07' }),
    event('later', { startsAt: '2026-12-05' }),
    event('undated-fresh', { fetchedAt: '2026-10-27T12:00:00.000Z' }),
  ], NOW);
  assert.deepEqual(sorted.map((item) => item.id),
    ['running-range', 'soon', 'later', 'undated-fresh', 'undated-old']);
});

test('the shipped events-sources.json entries all validate', () => {
  const sources = loadEventSources();
  assert.ok(sources.length >= 1);
  for (const source of sources) {
    assert.ok(validateEventSourceConfig(source), `source ${source.id} must validate`);
  }
});

// ---- events plane (fake Dynamo) ------------------------------------------------

const EVENT_URL = 'https://mauinow.test/fair';
const EVENT_ID = eventIdForUrl(EVENT_URL);
const storedEvent = {
  PK: `EVENT#${EVENT_ID}`, SK: 'META', entityId: EVENT_ID,
  title: 'Maui County Fair November 7-9', summary: 'All weekend at the fairgrounds.',
  url: EVENT_URL, source: 'octen-maui-happenings', causeTags: ['events', 'community'],
  urgency: 2, fetchedAt: '2026-10-27T18:00:00.000Z',
  startsAt: '2026-11-07', endsAt: '2026-11-09', status: 'live', verified: true,
};

function fakePlaneClient({ events = [storedEvent], optIns = [], locals = [], puts = [], queries = [] } = {}) {
  return {
    puts,
    async send(command) {
      if (command instanceof PutCommand) {
        puts.push(command.input.Item);
        return {};
      }
      if (command instanceof QueryCommand) {
        queries.push(command.input);
        return { Items: optIns.filter((item) => item.PK === command.input.ExpressionAttributeValues[':pk']) };
      }
      return { Items: [...events, ...optIns, ...locals] };
    },
  };
}

test('list counts only verified locals as going; opt-outs and other accounts do not count', async () => {
  const optIns = [
    { PK: 'USER#a', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true, ownerKey: 'a'.repeat(64) },
    { PK: 'USER#b', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true, ownerKey: 'b'.repeat(64) },
    { PK: 'USER#c', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: false, ownerKey: 'c'.repeat(64) },
    // Signed in, opted in, but not a verified local (or not a local at all).
    { PK: 'USER#d', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true, ownerKey: 'd'.repeat(64) },
    { PK: 'USER#e', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true, ownerKey: 'e'.repeat(64) },
  ];
  const locals = [
    { PK: 'LOCAL#la', SK: 'META', verified: true, status: 'verified', ownerKey: 'a'.repeat(64) },
    { PK: 'LOCAL#lb', SK: 'META', verified: true, status: 'verified', ownerKey: 'b'.repeat(64) },
    { PK: 'LOCAL#lc', SK: 'META', verified: true, status: 'verified', ownerKey: 'c'.repeat(64) },
    { PK: 'LOCAL#ld', SK: 'META', verified: false, status: 'pending', ownerKey: 'd'.repeat(64) },
  ];
  const plane = createEventsPlane({
    client: fakePlaneClient({ optIns, locals }), table: 't',
    PutCommand, QueryCommand, ScanCommand,
    getOctenKey: async () => '', now: () => NOW,
  });
  const events = await plane.list();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, EVENT_ID);
  assert.equal(events[0].localsGoing, 2);
  // The matcher gets every going opt-in and scores only the verified locals among them.
  const keys = await plane.optInKeys(EVENT_ID);
  assert.deepEqual([...keys].sort(), ['a', 'b', 'd', 'e'].map((c) => c.repeat(64)));
});

test('setOptIn validates the event, snapshots it, and stamps the hashed identity', async () => {
  const puts = [];
  const plane = createEventsPlane({
    client: fakePlaneClient({ puts }), table: 't',
    PutCommand, QueryCommand, ScanCommand,
    getOctenKey: async () => '', now: () => NOW,
  });
  assert.equal((await plane.setOptIn('uid-1', { eventId: 'nope' })).status, 400);
  assert.equal((await plane.setOptIn('uid-1', { eventId: eventIdForUrl('https://other.test/') })).status, 404);
  const ok = await plane.setOptIn('uid-1', { eventId: EVENT_ID, going: true });
  assert.equal(ok.status, 200);
  const item = puts.at(-1);
  assert.equal(item.PK, 'USER#uid-1');
  assert.equal(item.SK, `OPTIN#${EVENT_ID}`);
  assert.equal(item.going, true);
  assert.equal(item.title, storedEvent.title);
  assert.equal(item.startsAt, '2026-11-07');
  assert.match(item.ownerKey, /^[a-f0-9]{64}$/);
});

test('listOptIns queries only the caller partition and sorts dated plans first', async () => {
  const optIns = [
    {
      PK: 'USER#uid-1', SK: 'OPTIN#evt-aaaaaaaaaaaaaaaa', eventId: 'evt-aaaaaaaaaaaaaaaa',
      going: true, title: 'Undated find', startsAt: null, updatedAt: '2026-10-27T00:00:00.000Z',
    },
    {
      PK: 'USER#uid-1', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true,
      title: 'Fair', startsAt: '2026-11-07', endsAt: '2026-11-09',
    },
    { PK: 'USER#other', SK: `OPTIN#${EVENT_ID}`, eventId: EVENT_ID, going: true },
  ];
  const plane = createEventsPlane({
    client: fakePlaneClient({ optIns }), table: 't',
    PutCommand, QueryCommand, ScanCommand,
    getOctenKey: async () => '', now: () => NOW,
  });
  const result = await plane.listOptIns('uid-1');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map((item) => item.title), ['Fair', 'Undated find']);
});

test('refresh publishes EVENT# records with stable ids and reports per-source failures', async () => {
  const puts = [];
  const octenPayload = {
    code: 0,
    data: {
      results: [
        { title: 'Fair November 7', url: EVENT_URL, highlight: 'Fun.' },
        { title: 'Dupe of the fair', url: EVENT_URL, highlight: 'Same URL.' },
        { title: 'bad', url: 'http://insecure.test/' },
      ],
    },
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) throw new Error('socket hang up');
    return { ok: true, json: async () => octenPayload };
  };
  const plane = createEventsPlane({
    client: fakePlaneClient({ puts }), table: 't',
    PutCommand, QueryCommand, ScanCommand,
    getOctenKey: async () => 'octen-test-key', fetchImpl, now: () => NOW,
  });
  const sources = [
    { id: 'one', enabled: true, octen: { query: 'q1', causeTags: ['events'], urgency: 2 } },
    { id: 'two', enabled: true, octen: { query: 'q2', causeTags: ['events'], urgency: 2 } },
    { id: 'off', enabled: false, octen: { query: 'q3', causeTags: ['events'], urgency: 2 } },
  ];
  const summary = await plane.refresh({ sources });
  assert.equal(summary.published, 1);
  assert.deepEqual(summary.failures, ['two: socket hang up']);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].PK, `EVENT#${EVENT_ID}`);
  assert.equal(puts[0].entityType, 'event');
  assert.ok(puts[0].ttl > NOW.getTime() / 1000);
});

test('refresh without a configured key is a safe no-op', async () => {
  const puts = [];
  const plane = createEventsPlane({
    client: fakePlaneClient({ puts }), table: 't',
    PutCommand, QueryCommand, ScanCommand,
    getOctenKey: async () => '', fetchImpl: async () => { throw new Error('must not be called'); },
    now: () => NOW,
  });
  const summary = await plane.refresh({ sources: loadEventSources() });
  assert.equal(summary.published, 0);
  assert.equal(puts.length, 0);
  assert.equal(summary.failures.length, 1);
});

// ---- matcher integration -------------------------------------------------------

test('a visitor arriving from an event card matches the local who opted into it', async () => {
  const ownerKey = 'd'.repeat(64);
  const locals = [
    {
      PK: 'LOCAL#kai', SK: 'META', entityId: 'kai', name: 'Kai', town: 'Paia',
      interests: ['ocean'], causes: ['ocean'], status: 'verified', verified: true,
    },
    {
      PK: 'LOCAL#lani', SK: 'META', entityId: 'lani', name: 'Lani', town: 'Kihei',
      interests: ['ocean'], causes: ['ocean'], status: 'verified', verified: true,
      ownerKey,
    },
  ];
  const cause = {
    PK: 'CAUSE#reef', SK: 'META', entityId: 'reef',
    title: 'Restore the reef', summary: 'A source-backed need.',
    nonprofit: 'Maui Helpers', nonprofitId: 'maui-helpers',
    causeTags: ['ocean'], urgency: 3,
    url: 'https://example.test/reef', source: 'test-feed',
    fetchedAt: '2026-10-27T00:00:00.000Z', status: 'verified', verified: true,
  };
  const store = {
    async list(prefix) {
      if (prefix === 'LOCAL') return locals;
      if (prefix === 'CAUSE') return [cause];
      return [];
    },
    async put(prefix, fields) {
      return { ...fields, id: `${prefix}-id`, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    },
  };
  const events = { optInKeys: async (eventId) => (eventId === EVENT_ID ? new Set([ownerKey]) : new Set()) };
  const api = createPublicApi({ store, events });

  const boosted = await api.handle({
    method: 'POST', path: '/api/visitors',
    rawBody: JSON.stringify({ name: 'Ava', interests: ['ocean'], eventId: EVENT_ID }),
  });
  assert.equal(boosted.statusCode, 201);
  assert.equal(boosted.body.match.localName, 'Lani');
  assert.equal(boosted.body.match.eventOptIn, true);
  assert.equal(boosted.body.match.eventId, EVENT_ID);
  assert.match(boosted.body.match.why, /already plans to be at this event/);

  // Without the event context, deterministic tiebreak picks the first local id.
  const neutral = await api.handle({
    method: 'POST', path: '/api/visitors',
    rawBody: JSON.stringify({ name: 'Ben', interests: ['ocean'] }),
  });
  assert.equal(neutral.body.match.localName, 'Kai');
  assert.equal(neutral.body.match.eventOptIn, false);
});

test('a signed-in local join stores the hashed identity without echoing it back', async () => {
  const puts = [];
  const store = {
    async list() { return []; },
    async put(prefix, fields) {
      puts.push({ prefix, fields });
      return { ...fields, id: 'local-id', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    },
  };
  const api = createPublicApi({ store });
  const clientKey = 'e'.repeat(64);
  const created = await api.handle({
    method: 'POST', path: '/api/locals',
    rawBody: JSON.stringify({ name: 'Noe', interests: ['ocean'] }),
    clientKey,
  });
  assert.equal(created.statusCode, 201);
  assert.equal(puts[0].fields.ownerKey, clientKey);
  assert.equal(created.body.ownerKey, undefined);
  assert.equal(created.body.linkedToAccount, true);

  const anonymous = await api.handle({
    method: 'POST', path: '/api/locals',
    rawBody: JSON.stringify({ name: 'Ikaika', interests: ['ocean'] }),
  });
  assert.equal(anonymous.body.linkedToAccount, false);
  assert.equal(puts[1].fields.ownerKey, undefined);
});
