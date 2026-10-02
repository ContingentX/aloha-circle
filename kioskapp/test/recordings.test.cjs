const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { vastConfigFromEnv, signV4Put } = require('../src/vastUpload.cjs');
const { sessionFilename, saveRecordingAndUpload } = require('../src/recordings.cjs');

test('vastConfigFromEnv requires all four S3 vars', () => {
  assert.equal(vastConfigFromEnv({}), null);
  assert.equal(
    vastConfigFromEnv({ VAST_S3_ENDPOINT: 'https://x', VAST_S3_BUCKET: 'b', VAST_S3_ACCESS_KEY: 'a' }),
    null
  );
  const cfg = vastConfigFromEnv({
    VAST_S3_ENDPOINT: 'https://vast.example.com/',
    VAST_S3_BUCKET: 'team18',
    VAST_S3_ACCESS_KEY: 'AK',
    VAST_S3_SECRET_KEY: 'SK',
  });
  assert.equal(cfg.endpoint, 'https://vast.example.com'); // trailing slash stripped
  assert.equal(cfg.region, 'us-east-1');
  assert.equal(cfg.prefix, 'aloha-sessions/');
});

test('signV4Put matches the AWS SigV4 S3 PUT reference vector', () => {
  // Vector from the AWS docs examples (PUT test$file.text, us-east-1,
  // AKIAIOSFODNN7EXAMPLE) adapted to our fixed header set — computed once and
  // pinned so any change to the signing chain fails loudly.
  const { authorization } = signV4Put({
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    amzDate: '20130524T000000Z',
  });
  assert.equal(
    authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
      'Signature=e8a654937e21054a5da5e95e82cff2d3ee352d5aa6e0d966385c61adda282699'
  );
});

test('sessionFilename is sortable and keeps a short session id', () => {
  const name = sessionFilename(
    { sessionId: 'abcdef12-3456-7890' },
    new Date('2026-10-02T19:30:05Z')
  );
  assert.equal(name, 'aloha-20261002-193005-abcdef12.webm');
});

test('saveRecordingAndUpload stores video + metadata locally without VAST env', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloha-rec-'));
  const meta = { sessionId: 'deadbeef', stages: [{ id: 'welcome', atMs: 0 }] };
  const result = await saveRecordingAndUpload(Buffer.from('webm-bytes'), meta, { dir, env: {} });
  assert.equal(result.uploaded, false);
  assert.equal(result.synced, false);
  assert.ok(fs.existsSync(result.saved));
  const sidecar = JSON.parse(fs.readFileSync(result.saved.replace(/\.webm$/, '.json'), 'utf8'));
  assert.equal(sidecar.sessionId, 'deadbeef');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('vssSyncBodyFromEnv builds the batch-sync/start schema with read-only source creds', () => {
  const { vssSyncBodyFromEnv } = require('../src/vastUpload.cjs');
  assert.equal(vssSyncBodyFromEnv({}), null); // no VAST config -> nothing to sync
  const env = {
    VAST_S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
    VAST_S3_BUCKET: 'relay-bucket',
    VAST_S3_ACCESS_KEY: 'WRITEKEY',
    VAST_S3_SECRET_KEY: 'WRITESECRET',
    VAST_S3_PREFIX: 'media/vss-backfill/',
    VSS_SOURCE_ACCESS_KEY: 'READKEY',
    VSS_SOURCE_SECRET_KEY: 'READSECRET',
  };
  assert.deepEqual(vssSyncBodyFromEnv(env), {
    source_s3_endpoint: 'https://s3.us-east-1.amazonaws.com',
    source_access_key: 'READKEY',
    source_secret_key: 'READSECRET',
    source_bucket: 'relay-bucket',
    source_prefix: 'media/vss-backfill/',
  });
  // Without a dedicated read-only pair, the write pair is reused.
  delete env.VSS_SOURCE_ACCESS_KEY;
  delete env.VSS_SOURCE_SECRET_KEY;
  assert.equal(vssSyncBodyFromEnv(env).source_access_key, 'WRITEKEY');
});

test('transcodeToMp4 falls back to null on an invalid source', () => {
  const { transcodeToMp4 } = require('../src/recordings.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloha-tc-'));
  const bad = path.join(dir, 'not-video.webm');
  fs.writeFileSync(bad, 'not a video');
  assert.equal(transcodeToMp4(bad), null);
  assert.equal(fs.existsSync(path.join(dir, 'not-video.mp4')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
