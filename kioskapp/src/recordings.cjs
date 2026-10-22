// Persist a completed Breath of Aloha session recording and (when the VAST
// env is configured) push it to the team-18 bucket so it appears in VSS search.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { vastConfigFromEnv, uploadToVast, triggerVssSync } = require('./vastUpload.cjs');

// The team-18 VSS pipeline has only been exercised with mp4 sources, while
// MediaRecorder hands us webm. Best-effort local transcode; on any failure
// (no ffmpeg, bad input, timeout) the caller falls back to uploading webm.
// Async on purpose: this runs in the Electron main process, and a spawnSync
// here once froze the whole kiosk UI for the full timeout on an oversized
// recording.
const TRANSCODE_TIMEOUT_MS = 120000;

function transcodeToMp4(videoPath) {
  const mp4Path = videoPath.replace(/\.webm$/, '.mp4');
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      if (ok && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 0) return resolve(mp4Path);
      try { fs.unlinkSync(mp4Path); } catch (_) { /* never existed */ }
      resolve(null);
    };
    let child;
    try {
      child = spawn(
        'ffmpeg',
        ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4Path],
        { stdio: 'ignore' }
      );
    } catch (_) {
      return done(false);
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }, TRANSCODE_TIMEOUT_MS);
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('close', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

function sessionFilename(meta, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const id = String(meta && meta.sessionId ? meta.sessionId : 'session').slice(0, 8);
  return `aloha-${stamp}-${id}.webm`;
}

async function saveRecordingAndUpload(buffer, meta, opts = {}) {
  const env = opts.env || process.env;
  const dir = opts.dir || path.join(__dirname, '..', 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  const name = sessionFilename(meta, opts.now);
  const videoPath = path.join(dir, name);
  fs.writeFileSync(videoPath, buffer);
  fs.writeFileSync(videoPath.replace(/\.webm$/, '.json'), JSON.stringify(meta || {}, null, 2));

  const result = { saved: videoPath, uploaded: false, synced: false };
  const cfg = vastConfigFromEnv(env);
  if (cfg) {
    try {
      const mp4Path = opts.transcode === false ? null : await transcodeToMp4(videoPath);
      const uploadPath = mp4Path || videoPath;
      const uploadName = mp4Path ? name.replace(/\.webm$/, '.mp4') : name;
      result.url = await uploadToVast(uploadPath, `${cfg.prefix}${uploadName}`, cfg);
      result.uploaded = true;
      result.synced = await triggerVssSync(env);
    } catch (err) {
      result.error = String((err && err.message) || err);
      console.warn('[recordings] upload failed, kept local copy:', result.error);
    }
  }
  return result;
}

module.exports = { sessionFilename, transcodeToMp4, saveRecordingAndUpload };
