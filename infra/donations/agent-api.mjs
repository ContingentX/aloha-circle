// Harness-compatible public API used by the static web app.
//
// The production adapter is constructed by index.mjs and persists user-created
// records in the existing DynamoDB table. Keeping its dependencies injected and
// the domain logic here makes both locally testable without AWS credentials.
import { randomUUID } from 'node:crypto';

export const SEED_AGENT_DATA = {
  locals: [
    {
      id: 'seed-local-keoni',
      createdAt: '2026-08-29T00:00:00.000Z',
      name: 'Keoni',
      town: 'Lahaina',
      interests: ['diving', 'ocean', 'fishing'],
      causes: ['reef', 'ocean'],
      verified: true,
    },
    {
      id: 'seed-local-leilani',
      createdAt: '2026-08-29T00:00:01.000Z',
      name: 'Leilani',
      town: 'Paia',
      interests: ['photography', 'hiking', 'ocean'],
      causes: ['wildlife', 'trails'],
      verified: true,
    },
    {
      id: 'seed-local-makoa',
      createdAt: '2026-08-29T00:00:02.000Z',
      name: 'Makoa',
      town: 'Kahului',
      interests: ['farming', 'cooking', 'community'],
      causes: ['food-security', 'aina'],
      verified: true,
    },
  ],
  nonprofits: [
    {
      id: 'seed-npo-reef-guardians',
      createdAt: '2026-08-29T00:00:03.000Z',
      name: 'Maui Reef Guardians',
      causeTags: ['reef', 'ocean'],
      needs: ['cleanup volunteers', 'donations'],
      website: 'https://example.org/reef-guardians',
    },
    {
      id: 'seed-npo-trail-keepers',
      createdAt: '2026-08-29T00:00:04.000Z',
      name: 'Aloha Trail Keepers',
      causeTags: ['trails', 'wildlife', 'hiking'],
      needs: ['trail crew'],
      website: 'https://example.org/trail-keepers',
    },
    {
      id: 'seed-npo-food-hub',
      createdAt: '2026-08-29T00:00:05.000Z',
      name: 'Maui Food Hub',
      causeTags: ['food-security', 'aina', 'farming'],
      needs: ['produce sorters', 'drivers'],
      website: 'https://example.org/food-hub',
    },
  ],
  endorsements: [
    {
      id: 'seed-endorsement-keoni-reef',
      createdAt: '2026-08-29T00:00:06.000Z',
      local: 'Keoni',
      nonprofit: 'Maui Reef Guardians',
      verdict: 'helping_now',
      note: null,
      verified: true,
    },
    {
      id: 'seed-endorsement-leilani-reef',
      createdAt: '2026-08-29T00:00:07.000Z',
      local: 'Leilani',
      nonprofit: 'Maui Reef Guardians',
      verdict: 'helping_now',
      note: null,
      verified: true,
    },
    {
      id: 'seed-endorsement-makoa-food',
      createdAt: '2026-08-29T00:00:08.000Z',
      local: 'Makoa',
      nonprofit: 'Maui Food Hub',
      verdict: 'helping_now',
      note: null,
      verified: true,
    },
    {
      id: 'seed-endorsement-leilani-trails',
      createdAt: '2026-08-29T00:00:09.000Z',
      local: 'Leilani',
      nonprofit: 'Aloha Trail Keepers',
      verdict: 'generally_helping',
      note: null,
      verified: true,
    },
  ],
  causes: [
    {
      id: 'seed-cause-reef-cleanup',
      createdAt: '2026-08-29T00:00:10.000Z',
      title: 'Saturday reef cleanup at Kahekili Beach',
      nonprofit: 'Maui Reef Guardians',
      causeTags: ['reef', 'ocean', 'diving'],
      urgency: 4,
      summary: "Reef Guardians need 20 volunteers this Saturday to remove debris after last week's swell.",
      action: "Join Saturday's reef cleanup, 8 AM at Kahekili Beach.",
      url: 'https://example.org/reef-guardians/cleanup',
      source: 'maui-nonprofit-board',
      fetchedAt: '2026-08-29T00:00:10.000Z',
    },
    {
      id: 'seed-cause-food-sorting',
      createdAt: '2026-08-29T00:00:11.000Z',
      title: 'Produce sorting shifts at the Food Hub',
      nonprofit: 'Maui Food Hub',
      causeTags: ['food-security', 'community', 'farming'],
      urgency: 3,
      summary: "The Food Hub is short on hands to sort this week's farm surplus for Upcountry families.",
      action: 'Take a 2-hour sorting shift in Kahului, weekday mornings.',
      url: 'https://example.org/food-hub/shifts',
      source: 'maui-nonprofit-board',
      fetchedAt: '2026-08-29T00:00:11.000Z',
    },
    {
      id: 'seed-cause-trail-restoration',
      createdAt: '2026-08-29T00:00:12.000Z',
      title: 'Waihee Ridge trail restoration weekend',
      nonprofit: 'Aloha Trail Keepers',
      causeTags: ['trails', 'hiking', 'wildlife'],
      urgency: 2,
      summary: 'Trail Keepers are rebuilding switchbacks on Waihee Ridge and welcome visitor volunteers.',
      action: 'Sign up for a Sunday morning trail crew slot.',
      url: 'https://example.org/news/waihee-ridge',
      source: 'maui-news-events',
      fetchedAt: '2026-08-29T00:00:12.000Z',
    },
  ],
  visitors: [],
  matches: [],
};

const VERDICTS = ['helping_now', 'generally_helping', 'not_sure', 'causing_concern'];
const VERDICT_WEIGHT = { helping_now: 2, generally_helping: 1, not_sure: 0, causing_concern: -3 };

const text = (value, max = 160) =>
  (typeof value === 'string' ? value.trim().slice(0, max) : '');

const textList = (value, maxItems = 24) =>
  Array.isArray(value)
    ? value
      .slice(0, maxItems)
      .map((item) => text(item, 80))
      .filter(Boolean)
    : null;

const overlap = (left = [], right = []) => {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.filter((item) => rightSet.has(item.toLowerCase()));
};

const copy = (value) => structuredClone(value);

export function createDynamoAgentStore({ client, table, QueryCommand, PutCommand }) {
  if (!client?.send || !table || !QueryCommand || !PutCommand) {
    throw new Error('Dynamo agent store requires client, table, QueryCommand, and PutCommand');
  }
  return {
    async list(collection) {
      const records = [];
      let startKey;
      do {
        const page = await client.send(new QueryCommand({
          TableName: table,
          ConsistentRead: true,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `AGENT#${collection.toUpperCase()}`,
          },
          ExclusiveStartKey: startKey,
        }));
        records.push(...(page.Items ?? []).map((item) => item.record).filter(Boolean));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return records;
    },
    async insert(collection, record) {
      const retentionDays = {
        visitors: 30,
        matches: 30,
        locals: 180,
        nonprofits: 180,
        endorsements: 180,
      }[collection];
      const createdAt = Date.parse(record.createdAt);
      const ttl = retentionDays && Number.isFinite(createdAt)
        ? Math.floor(createdAt / 1000) + retentionDays * 86400
        : undefined;
      await client.send(new PutCommand({
        TableName: table,
        Item: {
          PK: `AGENT#${collection.toUpperCase()}`,
          SK: `ITEM#${record.id}`,
          record,
          ...(ttl ? { ttl } : {}),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
      return record;
    },
  };
}

export function createAgentApi({ store, uuid = randomUUID, now = () => new Date() }) {
  if (!store?.list || !store?.insert) throw new Error('agent API store requires list() and insert()');

  const timestamp = () => {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  };

  async function list(collection) {
    const seeded = SEED_AGENT_DATA[collection] ?? [];
    const saved = await store.list(collection);
    const records = new Map(seeded.map((record) => [record.id, copy(record)]));
    [...(saved ?? [])]
      .sort((a, b) => `${a.createdAt ?? ''}:${a.id ?? ''}`.localeCompare(`${b.createdAt ?? ''}:${b.id ?? ''}`))
      .forEach((record) => records.set(record.id, copy(record)));
    return [...records.values()];
  }

  async function insert(collection, fields) {
    const record = { id: uuid(), createdAt: timestamp(), ...fields };
    await store.insert(collection, record);
    return record;
  }

  async function matchVisitor(visitor) {
    const [allLocals, causes, allEndorsements] = await Promise.all([
      list('locals'),
      list('causes'),
      list('endorsements'),
    ]);
    // Public registrations are pending records. Only verified community input
    // may influence a visitor recommendation or its trust score.
    const locals = allLocals.filter((local) => local.verified === true);
    const endorsements = allEndorsements.filter((endorsement) => endorsement.verified === true);

    let best = null;
    for (const local of locals) {
      const sharedInterests = overlap(visitor.interests, local.interests);
      for (const cause of causes) {
        const localCauseFit = overlap(local.causes, cause.causeTags);
        const visitorCauseFit = overlap(visitor.interests, cause.causeTags);
        const trust = endorsements
          .filter((endorsement) => endorsement.nonprofit === cause.nonprofit)
          .reduce((score, endorsement) => score + (VERDICT_WEIGHT[endorsement.verdict] ?? 0), 0);
        const score =
          sharedInterests.length * 3
          + localCauseFit.length * 2
          + visitorCauseFit.length * 2
          + (Number(cause.urgency) || 0)
          + Math.min(trust, 5);
        if (!best || score > best.score) best = { local, cause, sharedInterests, score };
      }
    }
    if (!best || best.score <= 0) return null;

    return insert('matches', {
      visitorId: visitor.id,
      visitorName: visitor.name,
      localId: best.local.id,
      localName: best.local.name,
      localTown: best.local.town,
      cause: best.cause.title,
      causeTags: best.cause.causeTags,
      why: [
        best.sharedInterests.length
          ? `You and ${best.local.name} both care about ${best.sharedInterests.join(' and ')}.`
          : `${best.local.name} knows this cause well.`,
        best.cause.summary,
      ].join(' '),
      suggestedAction:
        best.cause.action ?? `Ask ${best.local.name} how to help with "${best.cause.title}".`,
      score: best.score,
    });
  }

  async function createVisitor(body) {
    const name = text(body?.name, 120);
    const interests = textList(body?.interests);
    if (!name || !interests?.length) {
      return { status: 400, body: { error: 'name and interests[] are required' } };
    }
    const visitor = await insert('visitors', {
      name,
      interests,
      availability: text(body.availability, 160) || null,
      groupType: text(body.groupType, 80) || null,
      desiredInvolvement: text(body.desiredInvolvement, 160) || null,
    });
    const match = await matchVisitor(visitor);
    return { status: 201, body: { visitor, match } };
  }

  async function createLocal(body) {
    const name = text(body?.name, 120);
    const interests = textList(body?.interests);
    if (!name || interests === null) {
      return { status: 400, body: { error: 'name and interests[] are required' } };
    }
    const causes = textList(body?.causes) ?? [];
    const record = await insert('locals', {
      name,
      interests,
      causes,
      town: text(body?.town, 120) || null,
      verified: false,
    });
    return { status: 201, body: record };
  }

  async function createNonprofit(body) {
    const name = text(body?.name, 120);
    const causeTags = textList(body?.causeTags);
    if (!name || causeTags === null) {
      return { status: 400, body: { error: 'name and causeTags[] are required' } };
    }
    const record = await insert('nonprofits', {
      name,
      causeTags,
      needs: textList(body?.needs) ?? [],
      website: text(body?.website, 500) || null,
    });
    return { status: 201, body: record };
  }

  async function createEndorsement(body) {
    const local = text(body?.local, 120);
    const nonprofit = text(body?.nonprofit, 120);
    const verdict = text(body?.verdict, 40);
    if (!local || !nonprofit || !VERDICTS.includes(verdict)) {
      return {
        status: 400,
        body: { error: `local, nonprofit and verdict (${VERDICTS.join('|')}) are required` },
      };
    }
    const record = await insert('endorsements', {
      local,
      nonprofit,
      verdict,
      note: text(body?.note, 500) || null,
      verified: false,
    });
    const { verified: _verified, ...publicRecord } = record;
    return { status: 201, body: publicRecord };
  }

  async function listNonprofits() {
    const [nonprofits, allEndorsements] = await Promise.all([list('nonprofits'), list('endorsements')]);
    const endorsements = allEndorsements.filter((endorsement) => endorsement.verified === true);
    return nonprofits.map((nonprofit) => ({
      ...nonprofit,
      endorsements: endorsements.filter((item) => item.nonprofit === nonprofit.name).length,
      helpingNow: endorsements.filter(
        (item) => item.nonprofit === nonprofit.name && item.verdict === 'helping_now',
      ).length,
    }));
  }

  return {
    async handle({ method, path, body = {} }) {
      if (method === 'GET' && path === '/api/causes') {
        return { status: 200, body: await list('causes') };
      }
      if (method === 'GET' && path === '/api/nonprofits') {
        return { status: 200, body: await listNonprofits() };
      }
      if (method === 'POST' && path === '/api/visitors') return createVisitor(body);
      if (method === 'POST' && path === '/api/locals') return createLocal(body);
      if (method === 'POST' && path === '/api/nonprofits') return createNonprofit(body);
      if (method === 'POST' && path === '/api/endorsements') return createEndorsement(body);
      return null;
    },
  };
}
