const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  attachWindowRecovery,
  pingRendererAfterResume,
  createGpuCrashTracker,
} = require('../src/resilience.cjs');

// Manual timer queue: scheduled callbacks run only when the test says so,
// which makes the delay/grace behavior deterministic.
function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutFn: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeoutFn: (id) => pending.delete(id),
    fire: () => {
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.fn();
    },
    count: () => pending.size,
  };
}

const quietLog = { warn: () => {}, error: () => {} };

function fakeWindow() {
  const webContents = new EventEmitter();
  webContents.reloads = 0;
  webContents.reload = () => { webContents.reloads += 1; };
  webContents.executeJavaScript = () => Promise.resolve(1);
  return {
    webContents,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
  };
}

// --- attachWindowRecovery: renderer crash ---

test('renderer crash recreates the window after the delay', () => {
  const win = fakeWindow();
  const timers = fakeTimers();
  let recreated = 0;
  attachWindowRecovery(win, () => { recreated += 1; }, { ...timers, log: quietLog });

  win.webContents.emit('render-process-gone', null, { reason: 'crashed' });
  assert.equal(recreated, 0, 'must wait out the delay before recreating');
  timers.fire();
  assert.equal(recreated, 1);
});

test('clean renderer exit does not recreate the window', () => {
  const win = fakeWindow();
  const timers = fakeTimers();
  let recreated = 0;
  attachWindowRecovery(win, () => { recreated += 1; }, { ...timers, log: quietLog });

  win.webContents.emit('render-process-gone', null, { reason: 'clean-exit' });
  timers.fire();
  assert.equal(recreated, 0);
});

// --- attachWindowRecovery: hung renderer ---

test('unresponsive renderer reloads after the grace period', () => {
  const win = fakeWindow();
  const timers = fakeTimers();
  attachWindowRecovery(win, () => {}, { ...timers, log: quietLog });

  win.webContents.emit('unresponsive');
  assert.equal(win.webContents.reloads, 0, 'grace period must elapse first');
  timers.fire();
  assert.equal(win.webContents.reloads, 1);
});

test('renderer recovering on its own cancels the reload', () => {
  const win = fakeWindow();
  const timers = fakeTimers();
  attachWindowRecovery(win, () => {}, { ...timers, log: quietLog });

  win.webContents.emit('unresponsive');
  win.webContents.emit('responsive');
  timers.fire();
  assert.equal(win.webContents.reloads, 0);
});

test('no reload of a window destroyed while hung', () => {
  const win = fakeWindow();
  const timers = fakeTimers();
  attachWindowRecovery(win, () => {}, { ...timers, log: quietLog });

  win.webContents.emit('unresponsive');
  win.destroyed = true;
  timers.fire();
  assert.equal(win.webContents.reloads, 0);
});

// --- pingRendererAfterResume ---

test('responsive renderer answers the resume ping — no reload', async () => {
  const win = fakeWindow();
  const result = await pingRendererAfterResume(win, {
    // Never fires the timeout: the ping should win the race.
    setTimeoutFn: () => 0,
    log: quietLog,
  });
  assert.equal(result, 'ok');
  assert.equal(win.webContents.reloads, 0);
});

test('frozen renderer (ping hangs) is reloaded after the timeout', async () => {
  const win = fakeWindow();
  win.webContents.executeJavaScript = () => new Promise(() => {});
  const result = await pingRendererAfterResume(win, {
    setTimeoutFn: (fn) => { fn(); return 0; }, // timeout fires immediately
    log: quietLog,
  });
  assert.equal(result, 'reloaded');
  assert.equal(win.webContents.reloads, 1);
});

test('renderer whose ping rejects is reloaded', async () => {
  const win = fakeWindow();
  win.webContents.executeJavaScript = () => Promise.reject(new Error('gone'));
  const result = await pingRendererAfterResume(win, {
    setTimeoutFn: () => 0,
    log: quietLog,
  });
  assert.equal(result, 'reloaded');
  assert.equal(win.webContents.reloads, 1);
});

test('destroyed window is left alone by the resume ping', async () => {
  const win = fakeWindow();
  win.destroyed = true;
  const result = await pingRendererAfterResume(win, { setTimeoutFn: () => 0, log: quietLog });
  assert.equal(result, 'destroyed');
  assert.equal(win.webContents.reloads, 0);
});

// --- createGpuCrashTracker ---

test('GPU crash loop within the window demands a relaunch', () => {
  const record = createGpuCrashTracker({ windowMs: 60_000, max: 3 });
  assert.equal(record(1_000), false);
  assert.equal(record(2_000), false);
  assert.equal(record(3_000), true, 'third crash in a minute = loop');
});

test('spread-out GPU crashes never demand a relaunch', () => {
  const record = createGpuCrashTracker({ windowMs: 60_000, max: 3 });
  assert.equal(record(0), false);
  assert.equal(record(70_000), false);
  assert.equal(record(140_000), false);
  assert.equal(record(210_000), false);
});
