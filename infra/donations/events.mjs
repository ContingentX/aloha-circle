// "Happening on Maui" events plane — Octen-fed EVENT# records, public listing,
// and signed-in local opt-ins ("I'd take a visitor to this").
//
// The scheduled refresh (EventBridge → this Lambda with {eventsRefresh: true})
// runs the version-controlled searches in events-sources.json and owns the
// EVENT# records wholesale: stable IDs are derived from the result URL, each
// refresh upserts, and a 45-day TTL ages out anything the live web stops
// mentioning. Pure rules live in events-core.mjs.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  eventIdForUrl,
  expandQuery,
  sortPublicEvents,
  toEventRecord,
  toPublicEvent,
  validateEventSourceConfig,
} from './events-core.mjs';

const OCTEN_SEARCH_URL = 'https://api.octen.ai/search';
const OCTEN_TIMEOUT_MS = 12_000;
const EVENT_TTL_DAYS = 45;
const OPTIN_TTL_DAYS = 120;
// Event-page chat: messages outlive the event record (a matched pair may still
// be coordinating after the card leaves the listing); presence marks fall off
// after two days so the "seen recently" rail stays honest.
const CHAT_TTL_DAYS = 120;
const PRESENCE_TTL_HOURS = 48;
const CHAT_TEXT_MAX = 400;
const CHAT_LIST_MAX = 200;
const PRESENCE_RECENT_HOURS = 24;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const loadEventSources = () => {
  const parsed = JSON.parse(
    readFileSync(new URL('./events-sources.json', import.meta.url), 'utf8'),
  );
  return Array.isArray(parsed?.sources) ? parsed.sources : [];
};

// Self-contained Octen Web Search call (mirrors agentharness/src/octen.js, but
// the Lambda package is a closed, reviewed module set — no cross-package
// imports survive infra/package-donations.sh, so the client lives here).
async function octenSearch(request, { apiKey, fetchImpl }) {
  const response = await fetchImpl(OCTEN_SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(OCTEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`octen responded with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(`octen returned code ${payload?.code ?? '?'}: ${payload?.msg ?? 'unknown error'}`);
  }
  if (!Array.isArray(payload?.data?.results)) throw new Error('octen response is missing data.results');
  return payload.data.results;
}

export function createEventsPlane({
  client,
  table,
  PutCommand,
  QueryCommand,
  ScanCommand,
  getOctenKey,
  fetchImpl = fetch,
  now = () => new Date(),
  cacheTtlMs = 3_000,
}) {
  let eventsCache;
  let eventsCacheUntil = 0;
  let eventsInflight;

  async function scanPages(input) {
    const items = [];
    let startKey;
    do {
      const out = await client.send(new ScanCommand({ ...input, ExclusiveStartKey: startKey }));
      items.push(...(out.Items ?? []));
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async function loadPlane() {
    const currentMs = now().getTime();
    if (eventsCache && currentMs < eventsCacheUntil) return eventsCache;
    if (eventsInflight) return eventsInflight;
    eventsInflight = scanPages({
      TableName: table,
      FilterExpression:
        '(begins_with(PK, :event) AND SK = :meta) OR (begins_with(PK, :user) AND begins_with(SK, :optin)) OR ' +
        '(begins_with(PK, :local) AND SK = :meta AND verified = :yes AND #status = :verified)',
      ExpressionAttributeValues: {
        ':event': 'EVENT#', ':meta': 'META', ':user': 'USER#', ':optin': 'OPTIN#',
        ':local': 'LOCAL#', ':yes': true, ':verified': 'verified',
      },
      ProjectionExpression:
        'PK, SK, entityId, title, summary, #url, #source, causeTags, urgency, fetchedAt, ' +
        'startsAt, endsAt, #status, verified, eventId, going, ownerKey',
      ExpressionAttributeNames: { '#url': 'url', '#source': 'source', '#status': 'status' },
    }).then((items) => {
      const plane = {
        events: items.filter((item) => item.PK?.startsWith('EVENT#') && item.SK === 'META'),
        optIns: items.filter((item) => item.SK?.startsWith('OPTIN#') && item.going === true),
        // Hashed identities of verified locals. Any signed-in account can opt
        // in, but only these count toward the public "locals going" number.
        verifiedLocalKeys: new Set(items
          .filter((item) => item.PK?.startsWith('LOCAL#') && item.SK === 'META' &&
            item.verified === true && item.status === 'verified' && typeof item.ownerKey === 'string')
          .map((item) => item.ownerKey)),
      };
      eventsCache = plane;
      eventsCacheUntil = now().getTime() + cacheTtlMs;
      return plane;
    }).finally(() => {
      eventsInflight = undefined;
    });
    return eventsInflight;
  }

  const invalidate = () => {
    eventsCache = undefined;
    eventsCacheUntil = 0;
  };

  // Hawaii decides when "today" ends (UTC-10, no DST).
  const hawaiiNow = () => new Date(now().getTime() - 10 * 3600e3);

  async function publicEvents() {
    const plane = await loadPlane();
    const goingCounts = new Map();
    for (const optIn of plane.optIns) {
      const eventId = typeof optIn.eventId === 'string' ? optIn.eventId : '';
      if (eventId && plane.verifiedLocalKeys.has(optIn.ownerKey)) {
        goingCounts.set(eventId, (goingCounts.get(eventId) ?? 0) + 1);
      }
    }
    return plane.events.map(toPublicEvent).filter(Boolean)
      .map((event) => ({ ...event, localsGoing: goingCounts.get(event.id) ?? 0 }));
  }

  async function list() {
    return sortPublicEvents(await publicEvents(), hawaiiNow());
  }

  // Event-page lookup by /e/<slug> or raw evt- id. Resolves against every
  // stored record, not the sorted listing, so a page people coordinated on
  // keeps rendering (with its past date) instead of 404ing the morning after.
  async function get(slugOrId) {
    const key = typeof slugOrId === 'string' ? slugOrId.trim().toLowerCase() : '';
    if (!key || key.length > 120) return null;
    const events = await publicEvents();
    return events.find((event) => event.slug === key || event.id === key) ?? null;
  }

  // ---- event-page chat + presence -------------------------------------------
  // One partition per event (EVTCHAT#<id>): MSG#<iso>#<suffix> items hold the
  // message history, SEEN#<authorKey> items hold presence heartbeats. Author
  // identity is the same hashed form (sha256 of the signed-in identity) used
  // by opt-ins — the raw uid never appears in a public payload.

  const chatPartition = (eventId) => `EVTCHAT#${eventId}`;

  const cleanChatText = (value) => {
    if (typeof value !== 'string') return '';
    // Strip control characters, collapse runs of whitespace, keep it one line.
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_TEXT_MAX);
  };

  const validIdentity = (identity) =>
    identity && typeof identity.authorKey === 'string' && /^[a-f0-9]{64}$/.test(identity.authorKey) &&
    typeof identity.name === 'string' && identity.name.trim().length > 0;

  async function queryChatItems(eventId) {
    const items = [];
    let startKey;
    do {
      const out = await client.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': chatPartition(eventId) },
        ExclusiveStartKey: startKey,
      }));
      items.push(...(out.Items ?? []));
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  const publicMessage = (item) => ({
    id: item.SK,
    authorKey: item.authorKey,
    name: typeof item.name === 'string' ? item.name : 'Aloha friend',
    photoURL: typeof item.photoURL === 'string' ? item.photoURL : null,
    text: typeof item.text === 'string' ? item.text : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
  });

  async function chatPayload(event) {
    const items = await queryChatItems(event.id);
    const messages = items
      .filter((item) => typeof item.SK === 'string' && item.SK.startsWith('MSG#'))
      .sort((a, b) => a.SK.localeCompare(b.SK))
      .slice(-CHAT_LIST_MAX)
      .map(publicMessage);
    const recentSinceMs = now().getTime() - PRESENCE_RECENT_HOURS * 3600e3;
    const presence = items
      .filter((item) => typeof item.SK === 'string' && item.SK.startsWith('SEEN#') &&
        typeof item.lastSeenAt === 'string' && Date.parse(item.lastSeenAt) >= recentSinceMs)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map((item) => ({
        authorKey: item.authorKey,
        name: typeof item.name === 'string' ? item.name : 'Aloha friend',
        photoURL: typeof item.photoURL === 'string' ? item.photoURL : null,
        lastSeenAt: item.lastSeenAt,
      }));
    // The server clock rides along so clients compute "online now" against it
    // instead of trusting their own clock.
    return { event, now: now().toISOString(), messages, presence };
  }

  async function chat(slugOrId) {
    const event = await get(slugOrId);
    if (!event) return { status: 404, body: { error: 'unknown event' } };
    return { status: 200, body: await chatPayload(event) };
  }

  async function touchPresence(identity, eventId) {
    const timestamp = now().toISOString();
    await client.send(new PutCommand({
      TableName: table,
      Item: {
        PK: chatPartition(eventId),
        SK: `SEEN#${identity.authorKey}`,
        eventId,
        authorKey: identity.authorKey,
        name: identity.name,
        ...(identity.photoURL ? { photoURL: identity.photoURL } : {}),
        lastSeenAt: timestamp,
        ttl: Math.floor(now().getTime() / 1000) + PRESENCE_TTL_HOURS * 3600,
      },
    }));
  }

  /** Signed-in heartbeat: marks the user present and returns the live payload. */
  async function presence(identity, slugOrId) {
    if (!validIdentity(identity)) return { status: 401, body: { error: 'sign in required' } };
    const event = await get(slugOrId);
    if (!event) return { status: 404, body: { error: 'unknown event' } };
    await touchPresence(identity, event.id);
    return { status: 200, body: await chatPayload(event) };
  }

  async function postChat(identity, slugOrId, body) {
    if (!validIdentity(identity)) return { status: 401, body: { error: 'sign in required' } };
    const event = await get(slugOrId);
    if (!event) return { status: 404, body: { error: 'unknown event' } };
    const text = cleanChatText(body?.text);
    if (!text) {
      return { status: 400, body: { error: `message text is required (up to ${CHAT_TEXT_MAX} characters)` } };
    }
    const timestamp = now().toISOString();
    // Deterministic suffix: a double-send of the same text in the same
    // millisecond upserts instead of duplicating.
    const suffix = sha256(`${identity.authorKey}:${timestamp}:${text}`).slice(0, 8);
    const item = {
      PK: chatPartition(event.id),
      SK: `MSG#${timestamp}#${suffix}`,
      eventId: event.id,
      authorKey: identity.authorKey,
      name: identity.name,
      ...(identity.photoURL ? { photoURL: identity.photoURL } : {}),
      text,
      createdAt: timestamp,
      ttl: Math.floor(now().getTime() / 1000) + CHAT_TTL_DAYS * 24 * 60 * 60,
    };
    await client.send(new PutCommand({ TableName: table, Item: item }));
    // Posting is presence.
    await touchPresence(identity, event.id);
    return { status: 201, body: { message: publicMessage(item) } };
  }

  /** Owner keys (sha256 of the signed-in identity) of locals opted into an event. */
  async function optInKeys(eventId) {
    if (typeof eventId !== 'string' || !/^evt-[a-f0-9]{16}$/.test(eventId)) return new Set();
    const plane = await loadPlane();
    return new Set(plane.optIns
      .filter((optIn) => optIn.eventId === eventId && typeof optIn.ownerKey === 'string')
      .map((optIn) => optIn.ownerKey));
  }

  async function setOptIn(uid, body) {
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
    if (!/^evt-[a-f0-9]{16}$/.test(eventId)) return { status: 400, body: { error: 'bad eventId' } };
    const going = body?.going === true;
    const plane = await loadPlane();
    const record = plane.events.find((item) => item.entityId === eventId);
    const event = record ? toPublicEvent(record) : null;
    if (!event) return { status: 404, body: { error: 'unknown event' } };
    const timestamp = now().toISOString();
    await client.send(new PutCommand({
      TableName: table,
      Item: {
        PK: `USER#${uid}`,
        SK: `OPTIN#${eventId}`,
        eventId,
        going,
        ownerKey: sha256(`firebase:${uid}`),
        // Snapshot what the calendar needs so it still renders after the
        // event record itself ages out of the live plane.
        title: event.title,
        url: event.url,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        causeTags: event.causeTags,
        updatedAt: timestamp,
        ttl: Math.floor(now().getTime() / 1000) + OPTIN_TTL_DAYS * 24 * 60 * 60,
      },
    }));
    invalidate();
    return { status: 200, body: { eventId, going, updatedAt: timestamp } };
  }

  async function listOptIns(uid) {
    const out = await client.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :optin)',
      ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':optin': 'OPTIN#' },
    }));
    const optIns = (out.Items ?? [])
      .filter((item) => typeof item.eventId === 'string')
      .map((item) => ({
        eventId: item.eventId,
        going: item.going === true,
        title: typeof item.title === 'string' ? item.title : '',
        url: typeof item.url === 'string' ? item.url : null,
        startsAt: typeof item.startsAt === 'string' ? item.startsAt : null,
        endsAt: typeof item.endsAt === 'string' ? item.endsAt : null,
        causeTags: Array.isArray(item.causeTags) ? item.causeTags : [],
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
      }))
      .sort((a, b) => (a.startsAt ?? '9999').localeCompare(b.startsAt ?? '9999'));
    return { status: 200, body: optIns };
  }

  async function refresh({ sources = loadEventSources() } = {}) {
    const apiKey = (await getOctenKey() ?? '').trim();
    if (!apiKey) return { published: 0, failures: ['octen key is not configured'] };
    const failures = [];
    let published = 0;
    // Searches run concurrently so the whole refresh fits well inside the
    // Lambda timeout even when a provider call hits its 12s client timeout.
    const prepared = [];
    for (const rawSource of sources) {
      const source = validateEventSourceConfig(rawSource);
      if (!source) {
        if (rawSource?.enabled === true) failures.push(`${rawSource?.id ?? '?'}: invalid source config`);
        continue;
      }
      prepared.push(source);
    }
    const searches = await Promise.allSettled(
      prepared.map((source) => octenSearch(
        { ...source.request, query: expandQuery(source.request.query, hawaiiNow()) },
        { apiKey, fetchImpl },
      )),
    );
    for (const [index, outcome] of searches.entries()) {
      const source = prepared[index];
      if (outcome.status === 'rejected') {
        failures.push(`${source.id}: ${outcome.reason?.message ?? outcome.reason}`);
        continue;
      }
      const results = outcome.value;
      const seen = new Set();
      for (const result of results) {
        const body = toEventRecord(result, {
          sourceId: source.id, causeTags: source.causeTags, urgency: source.urgency,
        }, now());
        if (!body) continue;
        const id = eventIdForUrl(body.url);
        if (seen.has(id)) continue;
        seen.add(id);
        const timestamp = now().toISOString();
        await client.send(new PutCommand({
          TableName: table,
          Item: {
            ...body,
            PK: `EVENT#${id}`,
            SK: 'META',
            entityType: 'event',
            entityId: id,
            schemaVersion: 1,
            version: 1,
            updatedAt: timestamp,
            ttl: Math.floor(now().getTime() / 1000) + EVENT_TTL_DAYS * 24 * 60 * 60,
          },
        }));
        published += 1;
      }
    }
    invalidate();
    return { published, failures };
  }

  return { chat, get, list, listOptIns, optInKeys, postChat, presence, refresh, setOptIn };
}
