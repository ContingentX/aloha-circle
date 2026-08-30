// AlohaLive API — Lambda (Node 20, no bundled deps; AWS SDK v3 ships in the runtime).
// All app data lives in AWS: DynamoDB (profiles, verification, experiences,
// donations, giveaway counters), S3 (residency-proof uploads), SES (nonprofit
// domain-proof codes). Firebase is used ONLY as the Google sign-in door: authed
// routes take a Firebase ID token in Authorization: Bearer and verify it here
// against Google's securetoken certs.
//
// Public:  GET /experiences · POST /donate · GET /spin?session_id=cs_...
//          GET /api/health · GET /api/nonprofits · GET /api/causes
//          POST /api/visitors · POST /api/locals · POST /api/endorsements
// Authed:  GET /me · POST /profile · POST /npo/claim · POST /npo/send-code
//          POST /npo/verify-code · POST /local/submit
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createVerify, createHash, randomInt, randomUUID } from 'crypto';

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ses = new SESv2Client({});

const TABLE = process.env.TABLE ?? 'alohalive';
const BUCKET = process.env.VERIFY_BUCKET;
const FIREBASE_PROJECT = 'contingentx-b0eab';
const FROM_EMAIL = 'verify@alohalive.net';
const ALLOWED_ORIGINS = [
  'https://alohalive.net',
  'https://www.alohalive.net',
  'https://dev.alohalive.net',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

let ssmCache = {};
async function param(name) {
  if (!ssmCache[name]) {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    ssmCache[name] = r.Parameter.Value;
  }
  return ssmCache[name];
}

// ---- Firebase ID token verification (Google securetoken, RS256) ----
let certs = { keys: null, exp: 0 };
async function googleCerts() {
  if (certs.keys && Date.now() < certs.exp) return certs.keys;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  certs = { keys: await res.json(), exp: Date.now() + maxAge * 1000 };
  return certs.keys;
}

async function verifyToken(headers) {
  const token = /^Bearer (.+)$/.exec(headers?.authorization ?? '')?.[1];
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!sig) return null;
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  const pem = (await googleCerts())[header.kid];
  if (!pem || header.alg !== 'RS256') return null;
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(pem, sig, 'base64url');
  const now = Math.floor(Date.now() / 1000);
  if (
    !ok ||
    payload.aud !== FIREBASE_PROJECT ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` ||
    payload.exp < now ||
    !payload.sub
  ) {
    return null;
  }
  return { uid: payload.sub, email: payload.email ?? '', emailVerified: payload.email_verified === true, name: payload.name ?? '' };
}

// ---- helpers ----
const resp = (status, body, origin) => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST',
  },
  body: JSON.stringify(body),
});
const emailDomain = (e) => (e ?? '').split('@')[1]?.toLowerCase() ?? '';
const hstDay = () => new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10); // Hawaii, no DST
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const getProfile = async (uid) =>
  (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${uid}`, SK: 'PROFILE' } }))).Item ?? null;

const publicProfile = (item) =>
  item && {
    name: item.name, email: item.email, photoURL: item.photoURL,
    role: item.role, airport: item.airport, orgName: item.orgName, domain: item.domain,
    originAirport: item.originAirport, arrivalDate: item.arrivalDate,
    travelerVerified: item.travelerVerified === true, language: item.language,
    verification: item.ver_status ? { status: item.ver_status, method: item.ver_method, proofEmail: item.ver_proofEmail } : null,
  };

async function stripe(path, form) {
  const key = await param('/alohalive/prod/STRIPE_SECRET_KEY');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`stripe ${res.status}: ${body.error?.message}`);
  return body;
}

// ---- authed routes ----
async function me(user, origin) {
  return resp(200, { profile: publicProfile(await getProfile(user.uid)) }, origin);
}

const PROFILE_FIELDS = ['name', 'role', 'airport', 'town', 'interests', 'groupType',
  'originAirport', 'arrivalDate', 'travelerVerified', 'language'];
async function saveProfile(user, body, origin) {
  const sets = { email: user.email, photoURL: body.photoURL ?? undefined };
  for (const f of PROFILE_FIELDS) if (body[f] !== undefined) sets[f] = body[f];
  if (sets.role && !['traveler', 'local', 'nonprofit'].includes(sets.role)) return resp(400, { error: 'bad role' }, origin);
  if (sets.originAirport !== undefined && !/^[A-Z]{3}$/.test(sets.originAirport)) return resp(400, { error: 'bad airport' }, origin);
  if (sets.arrivalDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(sets.arrivalDate)) return resp(400, { error: 'bad date' }, origin);
  if (sets.travelerVerified !== undefined) sets.travelerVerified = sets.travelerVerified === true;
  if (sets.language !== undefined && !/^[a-z]{2}$/.test(sets.language)) return resp(400, { error: 'bad language' }, origin);
  const names = {}, values = {}, parts = [];
  Object.entries(sets).forEach(([k, v], i) => {
    if (v === undefined) return;
    names[`#k${i}`] = k; values[`:v${i}`] = v; parts.push(`#k${i} = :v${i}`);
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return me(user, origin);
}

async function npoClaim(user, body, origin) {
  const domain = (body.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return resp(400, { error: 'invalid domain' }, origin);
  const instant = user.emailVerified && emailDomain(user.email) === domain;
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET #r = :r, orgName = :o, #d = :d, ver_status = :s, ver_method = :m, ver_proofEmail = :e, email = :em',
    ExpressionAttributeNames: { '#r': 'role', '#d': 'domain' },
    ExpressionAttributeValues: {
      ':r': 'nonprofit', ':o': String(body.orgName ?? '').slice(0, 120), ':d': domain,
      ':s': instant ? 'verified' : 'unverified',
      ':m': instant ? 'google-domain' : 'none',
      ':e': instant ? user.email : '',
      ':em': user.email,
    },
  }));
  return resp(200, { result: instant ? 'verified' : 'needs-email-proof' }, origin);
}

async function npoSendCode(user, body, origin) {
  const profile = await getProfile(user.uid);
  const domain = profile?.domain;
  if (!domain || profile.role !== 'nonprofit') return resp(400, { error: 'claim a domain first' }, origin);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (emailDomain(email) !== domain) return resp(400, { error: `email must be @${domain}` }, origin);
  const code = String(randomInt(100000, 1000000));
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `USER#${user.uid}`, SK: 'CODE',
      codeHash: sha256(code), email, domain, attempts: 0,
      ttl: Math.floor(Date.now() / 1000) + 15 * 60,
    },
  }));
  await ses.send(new SendEmailCommand({
    FromEmailAddress: `AlohaLive <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [email] },
    Content: {
      Simple: {
        Subject: { Data: `${code} — AlohaLive nonprofit verification` },
        Body: {
          Text: {
            Data:
`Aloha!

Someone signed in as ${user.email} is claiming ${domain} for the nonprofit "${profile.orgName ?? domain}" on alohalive.net.

Verification code: ${code}

Enter it on alohalive.net to confirm. The code expires in 15 minutes. If this wasn't you, ignore this email.

Mahalo,
AlohaLive`,
          },
        },
      },
    },
  }));
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET ver_status = :s, ver_method = :m, ver_proofEmail = :e',
    ExpressionAttributeValues: { ':s': 'pending', ':m': 'email-code', ':e': email },
  }));
  return resp(200, { sent: true }, origin);
}

async function npoVerifyCode(user, body, origin) {
  const rec = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'CODE' } }))).Item;
  if (!rec || rec.ttl < Date.now() / 1000) return resp(400, { error: 'code expired — request a new one' }, origin);
  if (rec.attempts >= 5) return resp(429, { error: 'too many attempts — request a new code' }, origin);
  if (sha256(String(body.code ?? '').trim()) !== rec.codeHash) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'CODE' },
      UpdateExpression: 'SET attempts = attempts + :one', ExpressionAttributeValues: { ':one': 1 },
    }));
    return resp(400, { error: 'incorrect code' }, origin);
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET ver_status = :s, ver_method = :m, ver_proofEmail = :e',
    ConditionExpression: '#d = :d',
    ExpressionAttributeNames: { '#d': 'domain' },
    ExpressionAttributeValues: { ':s': 'verified', ':m': 'email-code', ':e': rec.email, ':d': rec.domain },
  }));
  return resp(200, { verified: true }, origin);
}

async function localSubmit(user, body, origin) {
  const contentType = String(body.contentType ?? '');
  if (!/^image\//.test(contentType)) return resp(400, { error: 'image uploads only' }, origin);
  const airport = body.airport === 'OGG' ? 'OGG' : 'OGG'; // only OGG for now
  const key = `verify/${user.uid}/bill-${Date.now()}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 600 },
  );
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET #r = :r, airport = :a, ver_status = :s, ver_method = :m, ver_billKey = :k, email = :e',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: { ':r': 'local', ':a': airport, ':s': 'pending', ':m': 'bill-photo', ':k': key, ':e': user.email },
  }));
  return resp(200, { uploadUrl, key }, origin);
}

// ---- public data plane (/api/*) ----
// The visitor↔local↔cause matching data lives in the same single table, one
// item per record with SK 'META' (mirrors agentharness/src/store.js collections;
// the Aloha agent writes these same shapes to update the live site):
//   NPO#<slug>     { name, causeTags[], needs[], website, source }
//   CAUSE#<slug>   { title, summary, causeTags[], urgency, action?, nonprofit?, url? }
//   LOCAL#<id>     { name, town, interests[], causes[], verified }
//   VISITOR#<id>   { name, interests[], groupType? }
//   ENDORSE#<id>   { local, nonprofit, verdict, note? }
//   MATCH#<id>     { visitorName, localName, localTown, cause, why, suggestedAction, score }

async function scanPrefix(prefix) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk',
      ExpressionAttributeValues: { ':p': prefix, ':sk': 'META' },
      ExclusiveStartKey: startKey,
    }));
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

const str = (v, max) => String(v ?? '').slice(0, max);
const tags = (v, maxItems = 12) =>
  (Array.isArray(v) ? v : []).slice(0, maxItems).map((t) => str(t, 32)).filter(Boolean);

async function putRecord(prefix, fields) {
  const id = randomUUID();
  const item = { PK: `${prefix}#${id}`, SK: 'META', createdAt: new Date().toISOString(), ...fields };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return { id, ...fields, createdAt: item.createdAt };
}

async function apiHealth(origin) {
  const counts = {};
  for (const [name, prefix] of [
    ['nonprofits', 'NPO#'], ['causes', 'CAUSE#'], ['locals', 'LOCAL#'],
    ['visitors', 'VISITOR#'], ['endorsements', 'ENDORSE#'], ['matches', 'MATCH#'],
  ]) counts[name] = (await scanPrefix(prefix)).length;
  return resp(200, { ok: true, service: 'alohalive-api', counts }, origin);
}

async function listNonprofits(origin) {
  const [npos, endorsements, users] = await Promise.all([
    scanPrefix('NPO#'),
    scanPrefix('ENDORSE#'),
    ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk AND #r = :np AND ver_status = :v',
      ExpressionAttributeNames: { '#r': 'role' },
      ExpressionAttributeValues: { ':p': 'USER#', ':sk': 'PROFILE', ':np': 'nonprofit', ':v': 'verified' },
    })).then((out) => out.Items ?? []),
  ]);
  const seededNames = new Set(npos.map((n) => (n.name ?? '').toLowerCase()));
  // verified signed-up nonprofits appear alongside the seeded/agent-written ones
  const signups = users
    .filter((u) => u.orgName && !seededNames.has(u.orgName.toLowerCase()))
    .map((u) => ({ PK: u.PK, name: u.orgName, causeTags: [], needs: [], website: u.domain ? `https://${u.domain}/` : null }));
  const list = [...npos, ...signups].map((n) => {
    const forNp = endorsements.filter((e) => e.nonprofit === n.name);
    return {
      id: n.PK.slice(n.PK.indexOf('#') + 1),
      name: n.name, causeTags: n.causeTags ?? [], needs: n.needs ?? [], website: n.website ?? null,
      endorsements: forNp.length,
      helpingNow: forNp.filter((e) => e.verdict === 'helping_now').length,
    };
  }).sort((a, b) => b.helpingNow - a.helpingNow || a.name.localeCompare(b.name));
  return resp(200, list, origin);
}

async function listCauses(origin) {
  const causes = (await scanPrefix('CAUSE#'))
    .map((c) => ({
      id: c.PK.slice(6), title: c.title, summary: c.summary,
      causeTags: c.causeTags ?? [], urgency: c.urgency ?? 1,
    }))
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0));
  return resp(200, causes, origin);
}

// Deterministic matcher — same scoring as agentharness/src/matcher.js, so the
// TrueForge agent can replace it later with the same inputs and Match shape.
const overlap = (a = [], b = []) => {
  const setB = new Set(b.map((x) => String(x).toLowerCase()));
  return (a ?? []).filter((x) => setB.has(String(x).toLowerCase()));
};

async function createVisitor(body, origin) {
  const name = str(body.name, 80);
  const interests = tags(body.interests);
  if (!name || interests.length === 0) return resp(400, { error: 'name and interests[] are required' }, origin);
  const visitor = await putRecord('VISITOR', { name, interests, groupType: body.groupType ? str(body.groupType, 40) : null });

  const [locals, causes, endorsements] = await Promise.all([
    scanPrefix('LOCAL#'), scanPrefix('CAUSE#'), scanPrefix('ENDORSE#'),
  ]);
  const verdictWeight = { helping_now: 2, generally_helping: 1, not_sure: 0, causing_concern: -3 };
  let best = null;
  for (const local of locals) {
    const sharedInterests = overlap(interests, local.interests);
    for (const cause of causes) {
      const trust = endorsements
        .filter((e) => e.nonprofit === cause.nonprofit)
        .reduce((sum, e) => sum + (verdictWeight[e.verdict] ?? 0), 0);
      const score =
        sharedInterests.length * 3 +
        overlap(local.causes, cause.causeTags).length * 2 +
        overlap(interests, cause.causeTags).length * 2 +
        (cause.urgency ?? 0) +
        Math.min(trust, 5);
      if (!best || score > best.score) best = { local, cause, sharedInterests, score };
    }
  }
  let match = null;
  if (best && best.score > 0) {
    const why = [
      best.sharedInterests.length
        ? `You and ${best.local.name} both care about ${best.sharedInterests.join(' and ')}.`
        : `${best.local.name} knows this cause well.`,
      best.cause.summary,
    ].join(' ');
    match = await putRecord('MATCH', {
      visitorId: visitor.id, visitorName: name,
      localId: best.local.PK.slice(6), localName: best.local.name, localTown: best.local.town ?? null,
      cause: best.cause.title, causeTags: best.cause.causeTags ?? [],
      why,
      suggestedAction: best.cause.action ?? `Ask ${best.local.name} how to help with "${best.cause.title}".`,
      score: best.score,
    });
  }
  return resp(201, { visitor, match }, origin);
}

async function createLocal(body, origin) {
  const name = str(body.name, 80);
  const interests = tags(body.interests);
  if (!name || interests.length === 0) return resp(400, { error: 'name and interests[] are required' }, origin);
  const local = await putRecord('LOCAL', {
    name, interests, causes: tags(body.causes),
    town: body.town ? str(body.town, 80) : null, verified: false,
  });
  return resp(201, local, origin);
}

const VERDICTS = ['helping_now', 'generally_helping', 'not_sure', 'causing_concern'];
async function createEndorsement(body, origin) {
  const local = str(body.local, 80);
  const nonprofit = str(body.nonprofit, 120);
  if (!local || !nonprofit || !VERDICTS.includes(body.verdict)) {
    return resp(400, { error: `local, nonprofit and verdict (${VERDICTS.join('|')}) are required` }, origin);
  }
  const endorsement = await putRecord('ENDORSE', {
    local, nonprofit, verdict: body.verdict, note: body.note ? str(body.note, 280) : null,
  });
  return resp(201, endorsement, origin);
}

// ---- experiences ----
async function listExperiences(origin) {
  const out = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(PK, :p) AND SK = :sk AND active = :t',
    ExpressionAttributeValues: { ':p': 'EXP#', ':sk': 'META', ':t': true },
  }));
  const experiences = (out.Items ?? [])
    .map((i) => ({
      id: i.PK.slice(4), title: i.title, description: i.description,
      value: i.value, minDonation: i.minDonation, perDay: i.perDay, perMonth: i.perMonth, npoUid: i.npoUid,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return resp(200, { experiences }, origin);
}

async function createExperience(user, body, origin) {
  const profile = await getProfile(user.uid);
  if (profile?.role !== 'nonprofit' || profile?.ver_status !== 'verified') {
    return resp(403, { error: 'verified nonprofits only' }, origin);
  }
  const id = `${user.uid.slice(0, 8)}-${Date.now().toString(36)}`;
  const num = (v, min, fallback) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : fallback);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `EXP#${id}`, SK: 'META', npoUid: user.uid,
      title: String(body.title ?? '').slice(0, 120),
      description: String(body.description ?? '').slice(0, 500),
      value: num(body.value, 1, 1),
      minDonation: num(body.minDonation, 1, 10),
      perDay: num(body.perDay, 0, 1),
      perMonth: num(body.perMonth, 0, 10),
      active: true, createdAt: new Date().toISOString(),
    },
  }));
  return resp(200, { id }, origin);
}

// ---- donations ----
async function donate(body, origin) {
  const experienceId = String(body.experienceId ?? '');
  const exp = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EXP#${experienceId}`, SK: 'META' } }))).Item;
  if (!exp || exp.active !== true) return resp(404, { error: 'experience not available' }, origin);
  const amount = Math.floor(Number(body.amountUsd));
  if (!(amount >= exp.minDonation)) return resp(400, { error: `minimum donation is $${exp.minDonation}` }, origin);
  const site = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://alohalive.net';
  // Native app: bounce Stripe's redirect through /appreturn back into the app's
  // deep link. Only app schemes are accepted, so this can't become an open redirect.
  const appReturn = String(body.appReturn ?? '');
  const app = /^(exp|exps|alohalive):\/\/\S+$/.test(appReturn) ? encodeURIComponent(appReturn) : null;
  const session = await stripe('/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amount * 100),
    'line_items[0][price_data][product_data][name]': `AlohaLive donation — spin for: ${exp.title}`,
    success_url: app
      ? `${site}/appreturn?next=${app}&spin={CHECKOUT_SESSION_ID}`
      : `${site}/?spin={CHECKOUT_SESSION_ID}`,
    cancel_url: app ? `${site}/appreturn?next=${app}` : site,
    'metadata[experienceId]': experienceId,
  });
  return resp(200, { url: session.url }, origin);
}

async function bumpCounter(experienceId, period, cap) {
  // atomic: only increments while under cap; throws ConditionalCheckFailed at cap
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `CNT#${experienceId}`, SK: period },
    UpdateExpression: 'ADD #c :one',
    ConditionExpression: 'attribute_not_exists(#c) OR #c < :cap',
    ExpressionAttributeNames: { '#c': 'count' },
    ExpressionAttributeValues: { ':one': 1, ':cap': cap },
  }));
}

async function spin(sessionId, origin) {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId ?? '')) return resp(400, { error: 'bad session id' }, origin);
  const prior = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `DON#${sessionId}`, SK: 'META' } }))).Item;
  if (prior) return resp(200, { won: prior.won, title: prior.title, amountUsd: prior.amountUsd }, origin);

  let session;
  try {
    session = await stripe(`/checkout/sessions/${sessionId}`);
  } catch {
    return resp(404, { error: 'unknown session' }, origin);
  }
  if (session.payment_status !== 'paid') return resp(402, { error: 'payment not completed' }, origin);
  const experienceId = session.metadata?.experienceId ?? '';
  const exp = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EXP#${experienceId}`, SK: 'META' } }))).Item;
  const amountUsd = (session.amount_total ?? 0) / 100;

  // claim the donation record first (idempotency lock)
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `DON#${sessionId}`, SK: 'META', experienceId, amountUsd, won: false, title: exp?.title ?? '', npoUid: exp?.npoUid ?? '', day: hstDay(), createdAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch {
    const raced = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `DON#${sessionId}`, SK: 'META' } }))).Item;
    return resp(200, { won: raced?.won ?? false, title: raced?.title ?? '', amountUsd }, origin);
  }

  let won = false;
  if (exp && exp.active === true && exp.perDay > 0 && exp.perMonth > 0) {
    const day = hstDay();
    try {
      await bumpCounter(experienceId, day, exp.perDay);
      try {
        await bumpCounter(experienceId, day.slice(0, 7), exp.perMonth);
        won = true;
      } catch {
        // month cap hit — release the day slot
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: { PK: `CNT#${experienceId}`, SK: day },
          UpdateExpression: 'ADD #c :neg', ExpressionAttributeNames: { '#c': 'count' }, ExpressionAttributeValues: { ':neg': -1 },
        }));
      }
    } catch { /* day cap hit */ }
  }
  if (won) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { PK: `DON#${sessionId}`, SK: 'META' },
      UpdateExpression: 'SET won = :w', ExpressionAttributeValues: { ':w': true },
    }));
  }
  return resp(200, { won, title: exp?.title ?? '', amountUsd }, origin);
}

// ---- router ----
export const handler = async (event) => {
  const origin = event.headers?.origin ?? '';
  const method = event.requestContext?.http?.method;
  const path = event.rawPath ?? '/';
  try {
    if (method === 'OPTIONS') return resp(204, {}, origin);
    if (method === 'GET' && path === '/experiences') return await listExperiences(origin);
    if (method === 'POST' && path === '/donate') return await donate(JSON.parse(event.body ?? '{}'), origin);
    if (method === 'GET' && path === '/spin') {
      return await spin(new URLSearchParams(event.rawQueryString ?? '').get('session_id'), origin);
    }
    if (method === 'GET' && path === '/api/health') return await apiHealth(origin);
    if (method === 'GET' && path === '/api/nonprofits') return await listNonprofits(origin);
    if (method === 'GET' && path === '/api/causes') return await listCauses(origin);
    if (method === 'POST' && path === '/api/visitors') return await createVisitor(JSON.parse(event.body ?? '{}'), origin);
    if (method === 'POST' && path === '/api/locals') return await createLocal(JSON.parse(event.body ?? '{}'), origin);
    if (method === 'POST' && path === '/api/endorsements') return await createEndorsement(JSON.parse(event.body ?? '{}'), origin);

    const user = await verifyToken(event.headers);
    if (!user) return resp(401, { error: 'sign in required' }, origin);
    const body = method === 'POST' ? JSON.parse(event.body ?? '{}') : {};
    if (method === 'GET' && path === '/me') return await me(user, origin);
    if (method === 'POST' && path === '/profile') return await saveProfile(user, body, origin);
    if (method === 'POST' && path === '/npo/claim') return await npoClaim(user, body, origin);
    if (method === 'POST' && path === '/npo/send-code') return await npoSendCode(user, body, origin);
    if (method === 'POST' && path === '/npo/verify-code') return await npoVerifyCode(user, body, origin);
    if (method === 'POST' && path === '/local/submit') return await localSubmit(user, body, origin);
    if (method === 'POST' && path === '/experiences') return await createExperience(user, body, origin);
    return resp(404, { error: 'not found' }, origin);
  } catch (err) {
    console.error(err);
    return resp(500, { error: 'internal error' }, origin);
  }
};
