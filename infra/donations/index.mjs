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
//          POST /npo/verify-code · POST /local/submit · POST /local/confirm
//          POST /api/nonprofits (one pending submission per account/day)
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createVerify, createHash, randomInt, randomUUID } from 'crypto';
import { PublicApiError, parseJsonObject } from './public-api-core.mjs';
import { createDynamoPublicStore, createPublicApi } from './public-api.mjs';

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
  'https://aloha-circle.com',
  'https://www.aloha-circle.com',
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
    FromEmailAddress: `Aloha Circle <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [email] },
    Content: {
      Simple: {
        Subject: { Data: `${code} — Aloha Circle nonprofit verification` },
        Body: {
          Text: {
            Data:
`Aloha!

Someone signed in as ${user.email} is claiming ${domain} for the nonprofit "${profile.orgName ?? domain}" on Aloha Circle (aloha-circle.com).

Verification code: ${code}

Enter it back on the site to confirm. The code expires in 15 minutes. If this wasn't you, ignore this email.

Mahalo,
Aloha Circle`,
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
  // Keep verification unset until the client confirms the S3 upload succeeded.
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET #r = :r, airport = :a, ver_billKey = :k, email = :e',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: { ':r': 'local', ':a': airport, ':k': key, ':e': user.email },
  }));
  return resp(200, { uploadUrl, key }, origin);
}

async function localConfirm(user, body, origin) {
  const profile = await getProfile(user.uid);
  if (!profile?.ver_billKey || profile.ver_billKey !== String(body.key ?? '')) {
    return resp(400, { error: 'no matching upload — submit your document first' }, origin);
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { PK: `USER#${user.uid}`, SK: 'PROFILE' },
    UpdateExpression: 'SET ver_status = :s, ver_method = :m',
    ExpressionAttributeValues: { ':s': 'pending', ':m': 'bill-photo' },
  }));
  return me(user, origin);
}

// ---- public data plane (/api/*) ----
// The visitor↔local↔cause matching data lives in the same single table, one
// item per record with SK 'META'. Every record also carries stable entityType
// and entityId metadata; the Aloha agent must preserve these fields when it
// conditionally upserts a record. The current adapter uses one paginated,
// short-lived trusted-record scan so legacy records remain visible; an index
// migration can follow after the shared production table has been audited.
//   NPO#<slug>     { entityType: nonprofit, entityId, status, verified, ... }
//   CAUSE#<slug>   { entityType: cause, entityId, source, url, fetchedAt, ... }
//   LOCAL#<id>     { entityType: local, entityId, status, verified, ... }
//   VISITOR#<id>   { entityType: visitor, entityId, ttl, ... }
//   ENDORSE#<id>   { entityType: endorsement, entityId, status, verified, ... }
//   MATCH#<id>     { entityType: match, entityId, causeId, blocks, ttl, ... }
const publicStore = createDynamoPublicStore({
  client: ddb,
  table: TABLE,
  PutCommand,
  ScanCommand,
  randomId: randomUUID,
});
const publicApi = createPublicApi({ store: publicStore });

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
    'line_items[0][price_data][product_data][name]': `Aloha Circle donation — spin for: ${exp.title}`,
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
  let parsedBody;
  const body = () => {
    if (parsedBody === undefined) parsedBody = parseJsonObject(event.body ?? '{}');
    return parsedBody;
  };
  try {
    if (method === 'OPTIONS') return resp(204, {}, origin);
    if (method === 'GET' && path === '/experiences') return await listExperiences(origin);
    if (method === 'POST' && path === '/donate') return await donate(body(), origin);
    if (method === 'GET' && path === '/spin') {
      return await spin(new URLSearchParams(event.rawQueryString ?? '').get('session_id'), origin);
    }
    const authenticatedPublicSubmission = method === 'POST' && path === '/api/nonprofits';
    if (!authenticatedPublicSubmission) {
      const publicResult = await publicApi.handle({ method, path, rawBody: event.body });
      if (publicResult) return resp(publicResult.statusCode, publicResult.body, origin);
    }

    const user = await verifyToken(event.headers);
    if (!user) return resp(401, { error: 'sign in required' }, origin);
    if (authenticatedPublicSubmission) {
      const publicResult = await publicApi.handle({
        method,
        path,
        rawBody: event.body,
        clientKey: sha256(`firebase:${user.uid}`),
      });
      if (publicResult) return resp(publicResult.statusCode, publicResult.body, origin);
    }
    const requestBody = method === 'POST' ? body() : {};
    if (method === 'GET' && path === '/me') return await me(user, origin);
    if (method === 'POST' && path === '/profile') return await saveProfile(user, requestBody, origin);
    if (method === 'POST' && path === '/npo/claim') return await npoClaim(user, requestBody, origin);
    if (method === 'POST' && path === '/npo/send-code') return await npoSendCode(user, requestBody, origin);
    if (method === 'POST' && path === '/npo/verify-code') return await npoVerifyCode(user, requestBody, origin);
    if (method === 'POST' && path === '/local/submit') return await localSubmit(user, requestBody, origin);
    if (method === 'POST' && path === '/local/confirm') return await localConfirm(user, requestBody, origin);
    if (method === 'POST' && path === '/experiences') return await createExperience(user, requestBody, origin);
    return resp(404, { error: 'not found' }, origin);
  } catch (err) {
    console.error(err);
    if (err instanceof PublicApiError) return resp(err.status, { error: err.message }, origin);
    return resp(500, { error: 'internal error' }, origin);
  }
};
