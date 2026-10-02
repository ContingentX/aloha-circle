// Persist a completed Breath of Aloha session recording and (when the VAST
// env is configured) push it to the team-18 bucket so it appears in VSS search.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { vastConfigFromEnv, uploadToVast, triggerVssSync } = require('./vastUpload.cjs');

// The team-18 VSS pipeline has only been exercised with mp4 sources, while
// MediaRecorder hands us webm. Best-effort local transcode; on any failure
// (no ffmpeg, bad input, timeout) the caller falls back to uploading webm.
function transcodeToMp4(videoPath) {
  const mp4Path = videoPath.replace(/\.webm$/, '.mp4');
  try {
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4Path],
      { stdio: 'ignore', timeout: 120000 }
    );
    if (r.status === 0 && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 0) return mp4Path;
  } catch (_) { /* fall through to cleanup */ }
  try { fs.unlinkSync(mp4Path); } catch (_) { /* never existed */ }
  return null;
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
      const mp4Path = opts.transcode === false ? null : transcodeToMp4(videoPath);
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
