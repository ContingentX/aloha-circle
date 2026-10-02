// Upload session recordings to the team-18 VAST object store and nudge the
// VSS blueprint to ingest them (https://team-18-vss.thecosmoslabs.com).
// Dependency-free: SigV4 is implemented with node:crypto, HTTP via global fetch.
const crypto = require('crypto');
const fs = require('fs');

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// null unless all four required VAST_S3_* vars are present.
function vastConfigFromEnv(env) {
  const endpoint = env.VAST_S3_ENDPOINT;
  const bucket = env.VAST_S3_BUCKET;
  const accessKey = env.VAST_S3_ACCESS_KEY;
  const secretKey = env.VAST_S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKey,
    secretKey,
    region: env.VAST_S3_REGION || 'us-east-1',
    prefix: env.VAST_S3_PREFIX || 'aloha-sessions/',
  };
}

// AWS Signature V4 for a path-style S3 PUT. Pure — covered by unit tests.
function signV4Put({ host, path, payloadHash, accessKey, secretKey, region, amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    path,
    '', // no query string
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  let key = hmac(`AWS4${secretKey}`, dateStamp);
  key = hmac(key, region);
  key = hmac(key, 's3');
  key = hmac(key, 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
  };
}

async function uploadToVast(filePath, key, cfg) {
  const body = fs.readFileSync(filePath);
  const payloadHash = sha256hex(body);
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const { authorization } = signV4Put({
    host: url.host,
    path: url.pathname,
    payloadHash,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    region: cfg.region,
    amzDate,
  });
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Content-Type': 'video/webm',
    },
    body,
  });
  if (!res.ok) throw new Error(`VAST upload failed: ${res.status} ${await res.text()}`);
  return url.toString();
}

// Best-effort: log in to the VSS blueprint and kick a batch-sync so the new
// object shows up in /search. Returns false (never throws) when VSS_* env is
// missing or any call fails — the upload itself has already succeeded.
async function triggerVssSync(env) {
  const base = env.VSS_URL && env.VSS_URL.replace(/\/+$/, '');
  if (!base || !env.VSS_USERNAME || !env.VSS_PASSWORD) return false;
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env.VSS_USERNAME, password: env.VSS_PASSWORD }),
    });
    if (!login.ok) throw new Error(`login ${login.status}`);
    const { access_token } = await login.json();
    const auth = { Authorization: `Bearer ${access_token}` };
    const prefill = await fetch(`${base}/api/v1/batch-sync/prefill`, { headers: auth });
    const config = prefill.ok ? await prefill.json() : {};
    const start = await fetch(`${base}/api/v1/batch-sync/start`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!start.ok) throw new Error(`batch-sync/start ${start.status}`);
    return true;
  } catch (err) {
    console.warn('[vss] sync skipped:', err.message || err);
    return false;
  }
}

module.exports = { vastConfigFromEnv, signV4Put, uploadToVast, triggerVssSync };
