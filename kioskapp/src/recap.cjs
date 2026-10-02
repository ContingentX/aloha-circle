// Post-Mahalo recap reel generator.
//
// After a completed Breath of Aloha session, this module produces a short
// stylized recap clip: one ~2s segment per ritual stage, optionally processed
// through the Cosmos Generator NIM (Image2Video) for a polished look.
//
// Endpoint: COSMOS_GEN_URL env var. Supports two modes:
//
// 1. **OpenAI-compatible** (default): POST JSON to COSMOS_GEN_URL
//    { model, prompt, images: [dataUrl...], duration_seconds }
//    Response: { video: "data:video/mp4;base64,..." } or { data: [{ b64_video }] }
//
// 2. **NIM-native** (set COSMOS_GEN_MODE=nim): POST multipart/form-data
//    { images[], prompt, num_frames, fps }
//    Response: binary MP4 or JSON { video_base64 }
//
// Without COSMOS_GEN_URL or on error, falls back to ffmpeg concat (one ~2s
// slice per stage) so there's always a shareable artifact.

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const COSMOS_GEN_URL = process.env.COSMOS_GEN_URL || '';
const COSMOS_GEN_MODE = process.env.COSMOS_GEN_MODE || 'openai';
const COSMOS_GEN_MODEL = process.env.COSMOS_GEN_MODEL || 'nvidia/cosmos-generator-i2v';
const COSMOS_API_KEY = process.env.COSMOS_API_KEY || process.env.NVIDIA_API_KEY || '';

const STAGE_IDS = ['welcome', 'honi', 'eyes', 'ears', 'nose', 'heart', 'mahalo'];
const SLICE_DURATION = 2;
const FADE_DURATION = 0.3;

function hasFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function extractKeyframes(videoPath, meta, outputDir, opts = {}) {
  const stages = meta?.stages || [];
  if (!stages.length) return [];
  if (!hasFfmpeg()) {
    console.warn('[recap] ffmpeg not available, cannot extract keyframes');
    return [];
  }
  const frames = [];
  for (const stage of stages) {
    if (!STAGE_IDS.includes(stage.id)) continue;
    const timeSec = Math.max(0, (stage.atMs || 0) / 1000);
    const framePath = path.join(outputDir, `keyframe-${stage.id}.jpg`);
    try {
      execSync(
        `ffmpeg -y -ss ${timeSec.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`,
        { stdio: 'ignore', timeout: 30000 }
      );
      if (fs.existsSync(framePath)) {
        frames.push({ id: stage.id, path: framePath, atMs: stage.atMs });
      }
    } catch (err) {
      console.warn(`[recap] keyframe extract failed for ${stage.id}:`, err.message);
    }
  }
  return frames;
}

function frameToDataUrl(framePath) {
  const ext = path.extname(framePath).slice(1) || 'jpg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(framePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

async function callCosmosGenerator(frames, opts = {}) {
  const endpoint = opts.endpoint || COSMOS_GEN_URL;
  const mode = opts.mode || COSMOS_GEN_MODE;
  const model = opts.model || COSMOS_GEN_MODEL;
  const apiKey = opts.apiKey || COSMOS_API_KEY;

  if (!endpoint) return { ok: false, source: 'unset' };
  if (!frames?.length) return { ok: false, source: 'no-frames' };

  const prompt = 'Create a gentle, warm highlight reel of a mindfulness ritual journey';

  try {
    if (mode === 'nim') {
      return await callNimNative(endpoint, frames, prompt, apiKey, opts);
    } else {
      return await callOpenAICompatible(endpoint, frames, prompt, model, apiKey, opts);
    }
  } catch (err) {
    console.error('[recap] Cosmos Generator call failed:', err.message);
    return { ok: false, source: 'error', error: err.message };
  }
}

async function callOpenAICompatible(endpoint, frames, prompt, model, apiKey, opts) {
  const images = frames.map((f) => frameToDataUrl(f.path));
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    prompt,
    images,
    duration_seconds: frames.length * SLICE_DURATION,
    fps: 24,
  };

  const fetchFn = opts.fetch || fetch;
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cosmos Generator ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const videoData =
    json.video ||
    json.data?.[0]?.b64_video ||
    json.data?.[0]?.video ||
    json.choices?.[0]?.video;

  if (!videoData) {
    throw new Error('No video in response');
  }

  return { ok: true, source: 'cosmos', videoData };
}

async function callNimNative(endpoint, frames, prompt, apiKey, opts) {
  const FormData = require('form-data') || globalThis.FormData;
  const form = new FormData();

  for (const f of frames) {
    form.append('images', fs.createReadStream(f.path));
  }
  form.append('prompt', prompt);
  form.append('num_frames', String(frames.length * SLICE_DURATION * 24));
  form.append('fps', '24');

  const headers = form.getHeaders ? form.getHeaders() : {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const fetchFn = opts.fetch || fetch;
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cosmos NIM ${res.status}: ${text.slice(0, 200)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  let videoData;

  if (contentType.includes('video')) {
    const buf = Buffer.from(await res.arrayBuffer());
    videoData = `data:video/mp4;base64,${buf.toString('base64')}`;
  } else {
    const json = await res.json();
    videoData = json.video || json.video_base64;
    if (videoData && !videoData.startsWith('data:')) {
      videoData = `data:video/mp4;base64,${videoData}`;
    }
  }

  if (!videoData) throw new Error('No video in NIM response');
  return { ok: true, source: 'cosmos-nim', videoData };
}

function createFfmpegFallback(videoPath, meta, outputPath, opts = {}) {
  const stages = meta?.stages || [];
  if (!stages.length) return { ok: false, source: 'no-stages' };
  if (!hasFfmpeg()) return { ok: false, source: 'no-ffmpeg' };

  const duration = (meta.durationMs || 60000) / 1000;
  const slices = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!STAGE_IDS.includes(stage.id)) continue;

    const startSec = Math.max(0, (stage.atMs || 0) / 1000);
    const nextStart = stages[i + 1] ? stages[i + 1].atMs / 1000 : duration;
    const available = Math.max(0, nextStart - startSec);
    const sliceDur = Math.min(SLICE_DURATION, available);

    if (sliceDur > 0.5) {
      slices.push({ id: stage.id, start: startSec, duration: sliceDur });
    }
  }

  if (!slices.length) return { ok: false, source: 'no-valid-slices' };

  try {
    const filterParts = [];
    const concatInputs = [];

    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const fade =
        i < slices.length - 1
          ? `,fade=t=out:st=${(s.duration - FADE_DURATION).toFixed(2)}:d=${FADE_DURATION}`
          : '';
      filterParts.push(
        `[0:v]trim=start=${s.start.toFixed(2)}:duration=${s.duration.toFixed(2)},setpts=PTS-STARTPTS${fade}[v${i}]`
      );
      concatInputs.push(`[v${i}]`);
    }

    const filterComplex = `${filterParts.join('; ')}; ${concatInputs.join('')}concat=n=${slices.length}:v=1:a=0[out]`;

    execSync(
      `ffmpeg -y -i "${videoPath}" -filter_complex "${filterComplex}" -map "[out]" -c:v libx264 -preset fast -crf 23 "${outputPath}"`,
      { stdio: 'ignore', timeout: 120000 }
    );

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      return { ok: true, source: 'ffmpeg', path: outputPath };
    }
    return { ok: false, source: 'ffmpeg-empty' };
  } catch (err) {
    console.warn('[recap] ffmpeg fallback failed:', err.message);
    return { ok: false, source: 'ffmpeg-error', error: err.message };
  }
}

function saveVideoFromData(videoData, outputPath) {
  const match = videoData.match(/^data:video\/[^;]+;base64,(.+)$/);
  if (!match) throw new Error('Invalid video data URL');
  const buf = Buffer.from(match[1], 'base64');
  fs.writeFileSync(outputPath, buf);
  return outputPath;
}

async function generateRecap(videoPath, meta, opts = {}) {
  const dir = opts.dir || path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const recapPath = path.join(dir, `${baseName}-recap.mp4`);
  const tempDir = path.join(dir, '.recap-temp');

  fs.mkdirSync(tempDir, { recursive: true });

  const result = {
    source: 'none',
    path: null,
    fallbackUsed: false,
  };

  const cosmosEndpoint = opts.endpoint || COSMOS_GEN_URL;
  if (cosmosEndpoint) {
    const frames = extractKeyframes(videoPath, meta, tempDir, opts);
    if (frames.length) {
      const cosmosResult = await callCosmosGenerator(frames, opts);
      if (cosmosResult.ok && cosmosResult.videoData) {
        try {
          saveVideoFromData(cosmosResult.videoData, recapPath);
          result.source = cosmosResult.source;
          result.path = recapPath;
          cleanup(tempDir);
          return result;
        } catch (err) {
          console.warn('[recap] Failed to save Cosmos video:', err.message);
        }
      }
    }
  }

  const fallback = createFfmpegFallback(videoPath, meta, recapPath, opts);
  if (fallback.ok) {
    result.source = fallback.source;
    result.path = fallback.path;
    result.fallbackUsed = true;
  } else {
    result.source = fallback.source || 'failed';
    result.error = fallback.error;
  }

  cleanup(tempDir);
  return result;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function queueRecap(videoPath, meta, opts = {}) {
  const env = opts.env || process.env;
  const cosmosUrl = env.COSMOS_GEN_URL || '';
  const mode = env.COSMOS_GEN_MODE || 'openai';
  const model = env.COSMOS_GEN_MODEL || 'nvidia/cosmos-generator-i2v';
  const apiKey = env.COSMOS_API_KEY || env.NVIDIA_API_KEY || '';

  return generateRecap(videoPath, meta, {
    ...opts,
    endpoint: cosmosUrl,
    mode,
    model,
    apiKey,
  });
}

module.exports = {
  extractKeyframes,
  frameToDataUrl,
  callCosmosGenerator,
  createFfmpegFallback,
  generateRecap,
  queueRecap,
  hasFfmpeg,
  STAGE_IDS,
  SLICE_DURATION,
};
