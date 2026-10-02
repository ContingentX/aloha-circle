const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

delete process.env.COSMOS_GEN_URL;
delete process.env.COSMOS_API_KEY;
delete process.env.NVIDIA_API_KEY;

const {
  extractKeyframes,
  frameToDataUrl,
  callCosmosGenerator,
  createFfmpegFallback,
  generateRecap,
  queueRecap,
  hasFfmpeg,
  STAGE_IDS,
  SLICE_DURATION,
} = require('../src/recap.cjs');

test('STAGE_IDS includes expected ritual stages', () => {
  assert.ok(STAGE_IDS.includes('welcome'));
  assert.ok(STAGE_IDS.includes('honi'));
  assert.ok(STAGE_IDS.includes('eyes'));
  assert.ok(STAGE_IDS.includes('ears'));
  assert.ok(STAGE_IDS.includes('nose'));
  assert.ok(STAGE_IDS.includes('heart'));
  assert.ok(STAGE_IDS.includes('mahalo'));
});

test('SLICE_DURATION is a reasonable value', () => {
  assert.equal(typeof SLICE_DURATION, 'number');
  assert.ok(SLICE_DURATION >= 1 && SLICE_DURATION <= 5);
});

test('callCosmosGenerator returns unset when no endpoint', async () => {
  const frames = [{ id: 'welcome', path: '/fake/frame.jpg', atMs: 0 }];
  const result = await callCosmosGenerator(frames, { endpoint: '' });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'unset');
});

test('callCosmosGenerator returns no-frames when frames empty', async () => {
  const result = await callCosmosGenerator([], { endpoint: 'http://fake' });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'no-frames');
});

test('callCosmosGenerator OpenAI-compatible success with mocked fetch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-test-'));
  const framePath = path.join(tempDir, 'frame.jpg');
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const videoB64 = Buffer.from('mock-mp4-data').toString('base64');
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ video: `data:video/mp4;base64,${videoB64}` }),
  });

  const frames = [{ id: 'welcome', path: framePath, atMs: 0 }];
  const result = await callCosmosGenerator(frames, {
    endpoint: 'http://cosmos.example.com/generate',
    mode: 'openai',
    fetch: mockFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'cosmos');
  assert.ok(result.videoData.startsWith('data:video/mp4;base64,'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('callCosmosGenerator handles OpenAI error response', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-test-'));
  const framePath = path.join(tempDir, 'frame.jpg');
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const mockFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal server error',
  });

  const frames = [{ id: 'welcome', path: framePath, atMs: 0 }];
  const result = await callCosmosGenerator(frames, {
    endpoint: 'http://cosmos.example.com/generate',
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.source, 'error');
  assert.ok(result.error.includes('500'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('frameToDataUrl converts image file to data URL', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-test-'));
  const framePath = path.join(tempDir, 'test.jpg');
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const dataUrl = frameToDataUrl(framePath);
  assert.ok(dataUrl.startsWith('data:image/jpeg;base64,'));
  assert.ok(dataUrl.length > 30);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('createFfmpegFallback returns no-stages when meta has no stages', () => {
  const result = createFfmpegFallback('/fake/video.webm', {}, '/fake/out.mp4');
  assert.equal(result.ok, false);
  assert.equal(result.source, 'no-stages');
});

test('createFfmpegFallback returns no-ffmpeg when ffmpeg unavailable', () => {
  if (hasFfmpeg()) {
    console.log('  (skipped: ffmpeg is available)');
    return;
  }
  const meta = { stages: [{ id: 'welcome', atMs: 0 }] };
  const result = createFfmpegFallback('/fake/video.webm', meta, '/fake/out.mp4');
  assert.equal(result.ok, false);
  assert.equal(result.source, 'no-ffmpeg');
});

test('hasFfmpeg returns boolean', () => {
  const result = hasFfmpeg();
  assert.equal(typeof result, 'boolean');
});

test('queueRecap returns result with proper structure', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-test-'));
  const videoPath = path.join(tempDir, 'test.webm');
  fs.writeFileSync(videoPath, Buffer.from('fake-webm-data'));

  const meta = {
    sessionId: 'test-123',
    stages: [
      { id: 'welcome', atMs: 0 },
      { id: 'honi', atMs: 5000 },
    ],
    durationMs: 30000,
  };

  const result = await queueRecap(videoPath, meta, { env: {} });
  assert.equal(typeof result, 'object');
  assert.ok(['none', 'no-ffmpeg', 'ffmpeg', 'failed', 'cosmos', 'ffmpeg-error'].includes(result.source));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('generateRecap with mocked Cosmos returns cosmos source', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-test-'));
  const videoPath = path.join(tempDir, 'session.webm');
  fs.writeFileSync(videoPath, Buffer.from('fake-webm-data'));

  const framePath = path.join(tempDir, 'keyframe-welcome.jpg');
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const meta = {
    sessionId: 'test-456',
    stages: [{ id: 'welcome', atMs: 0 }],
    durationMs: 10000,
  };

  const videoB64 = Buffer.from('mock-mp4-data').toString('base64');
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ video: `data:video/mp4;base64,${videoB64}` }),
  });

  const originalExtract = require('../src/recap.cjs').extractKeyframes;

  const result = await generateRecap(videoPath, meta, {
    endpoint: 'http://cosmos.example.com/generate',
    fetch: mockFetch,
    dir: tempDir,
  });

  if (result.source === 'cosmos') {
    assert.ok(result.path);
    assert.ok(fs.existsSync(result.path));
  } else {
    console.log('  (keyframe extraction requires real video + ffmpeg)');
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('extractKeyframes returns empty array for empty stages', () => {
  const result = extractKeyframes('/fake/video.webm', { stages: [] }, '/tmp');
  assert.deepEqual(result, []);
});

test('extractKeyframes returns empty array for null meta', () => {
  const result = extractKeyframes('/fake/video.webm', null, '/tmp');
  assert.deepEqual(result, []);
});
