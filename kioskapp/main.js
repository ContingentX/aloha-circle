const { app, BrowserWindow, session, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const { askReasoner } = require('./src/reasoning.cjs');
const { judgeGesture, describeScene } = require('./src/cosmos.cjs');
const { analyzeBrands } = require('./src/brandSense.cjs');
const { saveRecordingAndUpload } = require('./src/recordings.cjs');
const { vastConfigFromEnv, uploadToVast, triggerVssSync } = require('./src/vastUpload.cjs');
const { queueRecap } = require('./src/recap.cjs');

const KIOSK = process.argv.includes('--kiosk');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    autoHideMenuBar: true,
    backgroundColor: '#04243a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  // Dev: KIOSK_STAGE=honi starts on a specific stage.
  const query = process.env.KIOSK_STAGE ? { stage: process.env.KIOSK_STAGE } : undefined;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query });

  // Smoke-test hook: KIOSK_SHOT=/path/out.png captures the window and quits.
  if (process.env.KIOSK_SHOT) {
    win.webContents.once('did-finish-load', () => {
      win.show();
      win.focus();
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          console.log('[shot] captured', JSON.stringify(img.getSize()));
          require('fs').writeFileSync(process.env.KIOSK_SHOT, img.toPNG());
        } catch (err) {
          console.error('[shot] failed:', err);
        }
        app.quit();
      }, Number(process.env.KIOSK_SHOT_DELAY || 5000));
    });
  }
}

app.whenReady().then(() => {
  // The kiosk camera is the whole product — grant media access without a prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'camera', 'microphone'].includes(permission));
  });

  // Optional reasoning hook (CoreWeave / W&B inference). Renderer gets a canned
  // line back when COREWEAVE_API_KEY isn't in the environment.
  ipcMain.handle('reasoning:ask', (_e, prompt) => askReasoner(prompt));
  ipcMain.handle('cosmos:judge', (_e, imageDataUrl, prompt) =>
    judgeGesture(imageDataUrl, prompt)
  );
  ipcMain.handle('cosmos:describe', (_e, imageDataUrl, prompt) =>
    describeScene(imageDataUrl, prompt)
  );
  ipcMain.handle('brands:analyze', (_e, imageDataUrl) => analyzeBrands(imageDataUrl));
  // Completed ritual recordings: saved locally, uploaded to the team-18 VAST
  // bucket + VSS search when VAST_S3_* / VSS_* env vars are set.
  ipcMain.handle('recording:save', (_e, buffer, meta) =>
    saveRecordingAndUpload(Buffer.from(buffer), meta)
  );

  // Post-Mahalo recap reel: queued async, doesn't block the kiosk loop.
  // Takes the saved video path + meta; generates a recap clip next to it.
  // The session uploader ran at save time, before the recap existed, so the
  // recap ships to VAST here once generated.
  ipcMain.handle('recap:generate', (_e, videoPath, meta) => {
    queueRecap(videoPath, meta)
      .then(async (result) => {
        if (!result.path) {
          console.warn('[recap] no output:', result.source, result.error || '');
          return;
        }
        console.log('[recap] generated:', result.path, 'source:', result.source);
        const cfg = vastConfigFromEnv(process.env);
        if (!cfg) return;
        try {
          await uploadToVast(result.path, `${cfg.prefix}${path.basename(result.path)}`, cfg);
          await triggerVssSync(process.env);
          console.log('[recap] uploaded to VAST');
        } catch (err) {
          console.warn('[recap] upload failed, kept local copy:', err.message);
        }
      })
      .catch((err) => console.error('[recap] error:', err.message));
    return { queued: true };
  });

  // Lid close kills the camera track; tell the renderer when the machine wakes
  // so it can abandon the stale session and re-acquire the camera.
  powerMonitor.on('resume', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('power:resume');
    }
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
