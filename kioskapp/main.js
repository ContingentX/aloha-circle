const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const { askReasoner } = require('./src/reasoning.cjs');

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

  createWindow();
});

app.on('window-all-closed', () => app.quit());
