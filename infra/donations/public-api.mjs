import {
  isPublicCause,
  isPublicNonprofit,
  isTrustedEndorsement,
  isTrustedLocal,
  parseJsonObject,
  rankMatch,
  toCauseSignal,
} from './public-api-core.mjs';
import { createHash } from 'node:crypto';

export const ENTITY_TYPE = {
  NPO: 'nonprofit', CAUSE: 'cause', LOCAL: 'local', VISITOR: 'visitor',
  ENDORSE: 'endorsement', MATCH: 'match',
};

export function createDynamoPublicStore({
  client,
  table,
  PutCommand,
  ScanCommand,
  randomId,
  now = () => new Date(),
  cacheTtlMs = 3_000,
}) {
  let trustedCache;
  let trustedCacheUntil = 0;
  let trustedInflight;
  let countsCache;
  let countsCacheUntil = 0;
  let countsInflight;
  let profileCache;
  let profileCacheUntil = 0;
  let profileInflight;

  async function scanPages(input) {
    const items = [];
    let startKey;
    do {
      const out = await client.send(new ScanCommand({
        ...input,
        ExclusiveStartKey: startKey,
      }));
      items.push(...(out.Items ?? []));
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async function loadTrustedRecords() {
    const currentMs = now().getTime();
    if (trustedCache && currentMs < trustedCacheUntil) return trustedCache;
    if (trustedInflight) return trustedInflight;
    trustedInflight = scanPages({
      TableName: table,
      FilterExpression:
        'SK = :sk AND verified = :yes AND #status = :verified AND ' +
        '(begins_with(PK, :npo) OR begins_with(PK, :cause) OR ' +
        'begins_with(PK, :local) OR begins_with(PK, :endorsement))',
      ExpressionAttributeValues: {
        ':sk': 'META', ':yes': true, ':verified': 'verified',
        ':npo': 'NPO#', ':cause': 'CAUSE#', ':local': 'LOCAL#', ':endorsement': 'ENDORSE#',
      },
      ProjectionExpression:
        'PK, SK, entityId, #name, causeTags, needs, website, #status, verified, #source, ' +
        'title, summary, urgency, #action, #url, nonprofit, nonprofitId, fetchedAt, interests, causes, ' +
        'town, localId, #local, verdict',
      ExpressionAttributeNames: {
        '#status': 'status', '#name': 'name', '#source': 'source', '#action': 'action',
        '#url': 'url', '#local': 'local',
      },
    }).then((items) => {
      trustedCache = items;
      trustedCacheUntil = now().getTime() + cacheTtlMs;
      return items;
    }).finally(() => {
      trustedInflight = undefined;
    });
    return trustedInflight;
  }

  async function list(prefix) {
    if (!ENTITY_TYPE[prefix]) return [];
    const expected = `${prefix}#`;
    return (await loadTrustedRecords()).filter((item) => item.PK?.startsWith(expected));
  }

  async function verifiedNonprofitProfiles() {
    const currentMs = now().getTime();
    if (profileCache && currentMs < profileCacheUntil) return profileCache;
    if (profileInflight) return profileInflight;
    profileInflight = scanPages({
      TableName: table,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk AND #r = :np AND ver_status = :v',
      ExpressionAttributeValues: { ':p': 'USER#', ':sk': 'PROFILE', ':np': 'nonprofit', ':v': 'verified' },
      ProjectionExpression: 'orgName, #domain',
      ExpressionAttributeNames: { '#r': 'role', '#domain': 'domain' },
    }).then((items) => {
      profileCache = items;
      profileCacheUntil = now().getTime() + cacheTtlMs;
      return items;
    }).finally(() => {
      profileInflight = undefined;
    });
    return profileInflight;
  }

  async function counts() {
    const currentMs = now().getTime();
    if (countsCache && currentMs < countsCacheUntil) return countsCache;
    if (countsInflight) return countsInflight;
    countsInflight = scanPages({
      TableName: table,
      FilterExpression:
        'SK = :sk AND (begins_with(PK, :npo) OR begins_with(PK, :cause) OR ' +
        'begins_with(PK, :local) OR begins_with(PK, :visitor) OR ' +
        'begins_with(PK, :endorsement) OR begins_with(PK, :match))',
      ExpressionAttributeValues: {
        ':sk': 'META', ':npo': 'NPO#', ':cause': 'CAUSE#', ':local': 'LOCAL#',
        ':visitor': 'VISITOR#', ':endorsement': 'ENDORSE#', ':match': 'MATCH#',
      },
      ProjectionExpression: 'PK, SK',
    }).then((items) => {
      const next = {};
      for (const [name, prefix] of [
        ['nonprofits', 'NPO'], ['causes', 'CAUSE'], ['locals', 'LOCAL'],
        ['visitors', 'VISITOR'], ['endorsements', 'ENDORSE'], ['matches', 'MATCH'],
      ]) next[name] = items.filter((item) => item.PK?.startsWith(`${prefix}#`)).length;
      countsCache = next;
      countsCacheUntil = now().getTime() + cacheTtlMs;
      return next;
    }).finally(() => {
      countsInflight = undefined;
    });
    return countsInflight;
  }

  function buildRecord(prefix, fields, { ttlDays, id = randomId(), current = now() } = {}) {
    if (!ENTITY_TYPE[prefix]) throw new Error(`unsupported public record prefix: ${prefix}`);
    const timestamp = current.toISOString();
    return {
      id,
      timestamp,
      item: {
        ...fields,
        PK: `${prefix}#${id}`,
        SK: 'META',
        entityType: ENTITY_TYPE[prefix],
        entityId: id,
        schemaVersion: 1,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(ttlDays ? { ttl: Math.floor(current.getTime() / 1000) + ttlDays * 24 * 60 * 60 } : {}),
      },
    };
  }

  function invalidateWriteCaches(fields) {
    if (fields.verified === true && fields.status === 'verified') {
      trustedCache = undefined;
      trustedCacheUntil = 0;
    }
    countsCache = undefined;
    countsCacheUntil = 0;
  }

  async function putDailySubmission(prefix, fields, scope, clientKey, { ttlDays } = {}) {
    const safeScope = typeof scope === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(scope)
      ? scope
      : null;
    const safeClientKey = typeof clientKey === 'string' && /^[a-f0-9]{64}$/.test(clientKey)
      ? clientKey
      : null;
    if (
      !safeScope || !safeClientKey ||
      !Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 180
    ) throw new Error('invalid daily submission configuration');

    const current = now();
    const window = current.toISOString().slice(0, 10);
    const id = createHash('sha256')
      .update(`submission:${safeScope}:${safeClientKey}:${window}`)
      .digest('hex');
    const record = buildRecord(prefix, fields, { ttlDays, id, current });
    try {
      await client.send(new PutCommand({
        TableName: table,
        Item: record.item,
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
    invalidateWriteCaches(fields);
    return {
      ...fields,
      id: record.id,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    };
  }

  async function put(prefix, fields, { ttlDays } = {}) {
    const record = buildRecord(prefix, fields, { ttlDays });
    await client.send(new PutCommand({
      TableName: table,
      Item: record.item,
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    invalidateWriteCaches(fields);
    return {
      ...fields,
      id: record.id,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    };
  }

  return { counts, list, put, putDailySubmission, verifiedNonprofitProfiles };
}

const str = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const optionalStr = (value, max) => str(value, max) || null;
const opaqueId = (value) => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (candidate.length > 120) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(candidate) ? candidate : null;
};
const recordId = (record, prefix) => opaqueId(record.entityId) ??
  (typeof record.PK === 'string' && record.PK.startsWith(`${prefix}#`)
    ? opaqueId(record.PK.slice(prefix.length + 1))
    : null);
const tags = (value, maxItems = 12) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const valueItem of value) {
    const tag = str(valueItem, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
    if (normalized.length === maxItems) break;
  }
  return normalized;
};
const httpUrl = (value) => {
  const candidate = str(value, 500);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
};
const signupPublicId = (domain) =>
  `signup-${createHash('sha256').update(domain).digest('hex').slice(0, 16)}`;
const result = (statusCode, body) => ({ statusCode, body });

export function createPublicApi({ store }) {
  async function health() {
    return result(200, { ok: true, service: 'alohalive-api', counts: await store.counts() });
  }

  async function nonprofits() {
    const [records, endorsements, users] = await Promise.all([
      store.list('NPO'), store.list('ENDORSE'), store.verifiedNonprofitProfiles(),
    ]);
    const publicNpos = records
      .filter(isPublicNonprofit)
      .map((record) => ({ ...record, name: str(record.name, 120) }))
      .filter((record) => record.name);
    const trustedEndorsements = endorsements.filter(isTrustedEndorsement);
    const knownNames = new Set(publicNpos.map((record) => record.name.trim().toLowerCase()));
    const signupCandidates = users
      .filter((user) => typeof user.orgName === 'string' && user.orgName.trim() &&
        typeof user.domain === 'string' && user.domain.trim())
      .map((user) => ({
        name: user.orgName.trim(),
        normalizedName: user.orgName.trim().toLowerCase(),
        domain: user.domain.trim().toLowerCase(),
        website: httpUrl(`https://${user.domain.trim().toLowerCase()}/`),
      }))
      .filter((user) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(user.domain) && user.website)
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
    const signupDomains = new Set();
    const signups = [];
    for (const user of signupCandidates) {
      if (signupDomains.has(user.domain) || knownNames.has(user.normalizedName)) continue;
      signupDomains.add(user.domain);
      knownNames.add(user.normalizedName);
      signups.push({
        entityId: signupPublicId(user.domain),
        name: user.name,
        causeTags: [],
        needs: [],
        website: user.website,
      });
    }
    const body = [...publicNpos, ...signups].map((record) => {
      const id = recordId(record, record.PK?.startsWith('NPO#') ? 'NPO' : 'USER');
      if (!id) return null;
      const forNonprofit = trustedEndorsements.filter((endorsement) =>
        endorsement.nonprofitId ? endorsement.nonprofitId === id : endorsement.nonprofit === record.name);
      return {
        id,
        name: record.name,
        causeTags: tags(record.causeTags),
        needs: tags(record.needs),
        website: httpUrl(record.website),
        endorsements: forNonprofit.length,
        helpingNow: forNonprofit.filter((endorsement) => endorsement.verdict === 'helping_now').length,
      };
    }).filter(Boolean).sort((a, b) => b.helpingNow - a.helpingNow || a.name.localeCompare(b.name));
    return result(200, body);
  }

  async function causes() {
    const body = (await store.list('CAUSE'))
      .filter(isPublicCause)
      .map(toCauseSignal)
      .filter(Boolean)
      .sort((a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id));
    return result(200, body);
  }

  async function createVisitor(body) {
    const name = str(body.name, 80);
    const interests = tags(body.interests);
    if (!name || interests.length === 0) return result(400, { error: 'name and interests[] are required' });
    const visitor = await store.put('VISITOR', {
      name,
      interests,
      availability: optionalStr(body.availability, 80),
      groupType: optionalStr(body.groupType, 40),
      desiredInvolvement: optionalStr(body.desiredInvolvement, 80),
    }, { ttlDays: 30 });
    const [locals, causeRecords, endorsements] = await Promise.all([
      store.list('LOCAL'), store.list('CAUSE'), store.list('ENDORSE'),
    ]);
    const ranked = rankMatch(visitor, { locals, causes: causeRecords, endorsements });
    const match = ranked ? await store.put('MATCH', ranked, { ttlDays: 30 }) : null;
    return result(201, { visitor, match });
  }

  async function createLocal(body) {
    const name = str(body.name, 80);
    const interests = tags(body.interests);
    if (!name || interests.length === 0) return result(400, { error: 'name and interests[] are required' });
    const local = await store.put('LOCAL', {
      name,
      interests,
      causes: tags(body.causes),
      town: optionalStr(body.town, 80),
      status: 'pending',
      verified: false,
    }, { ttlDays: 180 });
    return result(201, local);
  }

  async function createNonprofit(body, clientKey) {
    const name = str(body.name, 120);
    const causeTags = tags(body.causeTags);
    if (!name || causeTags.length === 0) return result(400, { error: 'name and causeTags[] are required' });
    if (typeof clientKey !== 'string' || !/^[a-f0-9]{64}$/.test(clientKey)) {
      return result(401, { error: 'sign in required' });
    }
    if (typeof store.putDailySubmission !== 'function') {
      throw new Error('daily submission store unavailable');
    }
    const nonprofit = await store.putDailySubmission('NPO', {
      name,
      causeTags,
      needs: tags(body.needs),
      website: httpUrl(body.website),
      source: 'community-submission',
      status: 'pending',
      verified: false,
    }, 'nonprofit', clientKey, { ttlDays: 30 });
    if (!nonprofit) return result(429, { error: 'one nonprofit submission is allowed per account each day' });
    return result(202, nonprofit);
  }

  async function createEndorsement(body) {
    const verdicts = ['helping_now', 'generally_helping', 'not_sure', 'causing_concern'];
    const local = str(body.local, 80);
    const nonprofit = str(body.nonprofit, 120);
    const localId = body.localId == null ? null : opaqueId(body.localId);
    const nonprofitId = body.nonprofitId == null ? null : opaqueId(body.nonprofitId);
    if (!local || !nonprofit || !verdicts.includes(body.verdict)) {
      return result(400, { error: `local, nonprofit and verdict (${verdicts.join('|')}) are required` });
    }
    if ((body.localId != null && !localId) || (body.nonprofitId != null && !nonprofitId)) {
      return result(400, { error: 'localId and nonprofitId must be bounded opaque IDs' });
    }
    const endorsement = await store.put('ENDORSE', {
      local,
      nonprofit,
      localId,
      nonprofitId,
      verdict: body.verdict,
      note: optionalStr(body.note, 280),
      source: 'community-submission',
      status: 'pending',
      verified: false,
    }, { ttlDays: 180 });
    return result(202, endorsement);
  }

  async function handle({ method, path, rawBody, clientKey }) {
    if (method === 'GET' && path === '/api/health') return health();
    if (method === 'GET' && path === '/api/nonprofits') return nonprofits();
    if (method === 'GET' && path === '/api/causes') return causes();
    if (method !== 'POST') return null;
    const handlers = {
      '/api/visitors': createVisitor,
      '/api/locals': createLocal,
      '/api/nonprofits': createNonprofit,
      '/api/endorsements': createEndorsement,
    };
    const handler = handlers[path];
    return handler ? handler(parseJsonObject(rawBody ?? '{}'), clientKey) : null;
  }

  return { handle };
}
