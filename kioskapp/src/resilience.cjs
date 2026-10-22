// Self-recovery for the kiosk window. A kiosk runs unattended: a crashed or
// hung renderer, or a renderer that never woke up after the lid reopened, has
// to come back on its own — nobody is there to press reload.
//
// Everything time- and Electron-shaped is injectable so the policy is testable
// with fakes (see test/resilience.test.cjs).

const RESTART_DELAY_MS = 3000;
const UNRESPONSIVE_GRACE_MS = 5000;
const RESUME_PING_TIMEOUT_MS = 8000;
const GPU_CRASH_WINDOW_MS = 60_000;
const GPU_CRASH_MAX = 3;

// Attach crash/hang recovery to a BrowserWindow. `recreate` must destroy any
// surviving window and build a fresh one (the renderer process is gone, so a
// reload has nothing to talk to).
function attachWindowRecovery(win, recreate, opts = {}) {
  const delayMs = opts.delayMs ?? RESTART_DELAY_MS;
  const graceMs = opts.graceMs ?? UNRESPONSIVE_GRACE_MS;
  const setT = opts.setTimeoutFn ?? setTimeout;
  const clearT = opts.clearTimeoutFn ?? clearTimeout;
  const log = opts.log ?? console;

  win.webContents.on('render-process-gone', (_event, details) => {
    // clean-exit = normal shutdown (app quit, window close) — not a failure.
    if (details && details.reason === 'clean-exit') return;
    log.warn(`[resilience] renderer gone (${details?.reason}) — recreating window in ${delayMs}ms`);
    setT(() => recreate(), delayMs);
  });

  let hangTimer = null;
  win.webContents.on('unresponsive', () => {
    if (hangTimer) return;
    log.warn(`[resilience] renderer unresponsive — reloading in ${graceMs}ms unless it recovers`);
    hangTimer = setT(() => {
      hangTimer = null;
      // Still hung after the grace: force a reload. If the process itself is
      // wedged beyond reload, render-process-gone recovery takes over.
      if (!win.isDestroyed()) win.webContents.reload();
    }, graceMs);
  });
  win.webContents.on('responsive', () => {
    if (!hangTimer) return;
    log.warn('[resilience] renderer recovered on its own');
    clearT(hangTimer);
    hangTimer = null;
  });
}

// After system resume (lid reopen) the renderer is told to re-acquire the
// camera — but a renderer that froze during sleep never gets that message.
// Ping it: if it can't evaluate `1` within the timeout, reload it.
async function pingRendererAfterResume(win, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? RESUME_PING_TIMEOUT_MS;
  const setT = opts.setTimeoutFn ?? setTimeout;
  const log = opts.log ?? console;
  if (win.isDestroyed()) return 'destroyed';
  const timeout = new Promise((resolve) => setT(() => resolve('timeout'), timeoutMs));
  const ping = win.webContents.executeJavaScript('1').then(() => 'ok', () => 'error');
  const result = await Promise.race([ping, timeout]);
  if (result !== 'ok' && !win.isDestroyed()) {
    log.warn(`[resilience] renderer did not answer resume ping (${result}) — reloading`);
    win.webContents.reload();
    return 'reloaded';
  }
  return result;
}

// Electron restarts a crashed GPU process by itself; a GPU crash *loop* is the
// failure mode worth acting on. Returns a recorder: call it on every GPU
// crash, and it answers true when the whole app should relaunch.
function createGpuCrashTracker(opts = {}) {
  const windowMs = opts.windowMs ?? GPU_CRASH_WINDOW_MS;
  const max = opts.max ?? GPU_CRASH_MAX;
  let crashes = [];
  return function recordCrash(now = Date.now()) {
    crashes = crashes.filter((t) => now - t < windowMs);
    crashes.push(now);
    return crashes.length >= max;
  };
}

module.exports = {
  attachWindowRecovery,
  pingRendererAfterResume,
  createGpuCrashTracker,
  RESTART_DELAY_MS,
  UNRESPONSIVE_GRACE_MS,
  RESUME_PING_TIMEOUT_MS,
  GPU_CRASH_WINDOW_MS,
  GPU_CRASH_MAX,
};
