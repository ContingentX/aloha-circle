// Persist a completed Breath of Aloha session recording and (when the VAST
// env is configured) push it to the team-18 bucket so it appears in VSS search.
const fs = require('fs');
const path = require('path');
const { vastConfigFromEnv, uploadToVast, triggerVssSync } = require('./vastUpload.cjs');

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
      result.url = await uploadToVast(videoPath, `${cfg.prefix}${name}`, cfg);
      result.uploaded = true;
      result.synced = await triggerVssSync(env);
    } catch (err) {
      result.error = String((err && err.message) || err);
      console.warn('[recordings] upload failed, kept local copy:', result.error);
    }
  }
  return result;
}

module.exports = { sessionFilename, saveRecordingAndUpload };
