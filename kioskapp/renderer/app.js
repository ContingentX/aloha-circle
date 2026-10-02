import { STAGES } from './stages.js';
import { MEDIA_BASE } from './config.js';
import { createPoseDetector } from './pose.js';
import { GESTURE_PROMPTS } from './gestures.js';
import { createSessionRecorder } from './recorder.js';
import { createAvatarPlacer, applyPlacement } from './avatarPlacement.js';
import { initAdminMode } from './adminMode.js';
import { createBrandSense } from './brands.js';

const $ = (id) => document.getElementById(id);
const els = {
  camera: $('camera'),
  emoji: $('stage-emoji'),
  title: $('stage-title'),
  subtitle: $('stage-subtitle'),
  instruction: $('stage-instruction'),
  avatarCard: $('avatar-card'),
  avatarVideo: $('avatar-video'),
  holdRing: $('hold-ring'),
  holdCount: $('hold-count'),
  ringFg: document.querySelector('.ring-fg'),
  back: $('btn-back'),
  next: $('btn-next'),
  skip: $('btn-skip'),
  progress: $('progress'),
  cameraError: $('camera-error'),
  saveStatus: $('save-status'),
  brandList: $('brand-list'),
};

const startStage = new URLSearchParams(location.search).get('stage');
let stageIndex = Math.max(0, STAGES.findIndex((s) => s.id === startStage));
let holdTimer = null;
let stallTimer = null;
let cameraStream = null;
const pose = createPoseDetector();
const recorder = createSessionRecorder();
const avatarPlacer = createAvatarPlacer();
const brands = createBrandSense({
  listEl: els.brandList,
  describe: (image, prompt) =>
    typeof window.kiosk?.describeScene === 'function'
      ? window.kiosk.describeScene(image, prompt)
      : Promise.resolve({ ok: false, source: 'unset' }),
  snapshot: () => (els.camera.videoWidth ? snapshot(els.camera) : null),
  onChange: (items) => {
    if (recorder.active()) recorder.noteLabels(items);
  },
});

// ---- camera ---------------------------------------------------------------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
      audio: false,
    });
    els.camera.srcObject = stream;
    cameraStream = stream;
    els.cameraError.classList.add('hidden');
    pose.start(els.camera, onPoseEvent);
    brands.start();
  } catch (err) {
    console.error('camera failed:', err);
    els.cameraError.classList.remove('hidden');
  }
}

function onPoseEvent(payload) {
  if (payload && payload.type === 'pose') {
    updateAvatarPlacement(payload.person, payload.video);
    const live = [];
    if (payload.person) live.push({ name: 'person', kind: 'label' });
    if (payload.event) live.push({ name: payload.event, kind: 'label' });
    if (live.length) brands.push(live);
    return;
  }
  const event = payload && payload.event ? payload.event : payload;
  const stage = STAGES[stageIndex];
  if (!stage.detect || event !== stage.detect) return;
  if (stage.kind === 'hold') {
    if (!holdTimer) startHold(stage.holdSeconds, advance);
    return;
  }
  advance();
}

function updateAvatarPlacement(person, video) {
  if (els.avatarCard.classList.contains('hidden')) return;
  const position = avatarPlacer.update(person, video);
  if (position) {
    applyPlacement(els.avatarCard, position);
  }
}

function snapshot(video) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

const STALL_FIRST_MS = 8000;
const STALL_RETRY_MS = 5000;
let stallGen = 0;

function armStallJudge() {
  clearTimeout(stallTimer);
  stallTimer = null;
  const gen = ++stallGen;
  const stage = STAGES[stageIndex];
  if (!stage.detect || typeof window.kiosk?.judgeGesture !== 'function') return;
  const prompt = GESTURE_PROMPTS[stage.detect];
  if (!prompt) return;
  const live = () => gen === stallGen && STAGES[stageIndex].id === stage.id;
  const poll = async () => {
    if (!live()) return;
    let advanced = false;
    try {
      const judge = await window.kiosk.judgeGesture(snapshot(els.camera), prompt);
      if (judge?.ok && live()) {
        advanced = true;
        onPoseEvent({ type: 'gesture', event: stage.detect, source: 'cosmos' });
      }
    } catch (err) {
      console.warn('[cosmos] stall judge skipped', err);
    }
    // A NO (or a timeout) is not final — the visitor may settle into the pose
    // after the first check. Keep asking until the stage moves on.
    if (!advanced && live()) {
      stallTimer = setTimeout(poll, STALL_RETRY_MS);
    }
  };
  stallTimer = setTimeout(poll, STALL_FIRST_MS);
}

// ---- avatar clips ---------------------------------------------------------
function playClip(name) {
  if (!name) {
    els.avatarCard.classList.add('hidden');
    els.avatarVideo.pause();
    els.avatarVideo.removeAttribute('src');
    avatarPlacer.reset();
    return;
  }
  els.avatarCard.classList.remove('hidden');
  avatarPlacer.reset();
  applyPlacement(els.avatarCard, avatarPlacer.forceUpdate(null, null));
  const local = `../assets/clips/${name}.mp4`;
  const remote = `${MEDIA_BASE}/${name}.mp4`;
  els.avatarVideo.onerror = () => {
    if (!els.avatarVideo.src.startsWith('http')) {
      els.avatarVideo.src = remote; // local file missing -> stream from the site bucket
      els.avatarVideo.play().catch(() => {});
    }
  };
  els.avatarVideo.onerror.wired = true;
  els.avatarVideo.src = local;
  els.avatarVideo.play().catch(() => {});
}

// ---- honi ihu breath hold -------------------------------------------------
function startHold(seconds, onDone) {
  cancelHold();
  const total = seconds * 1000;
  els.holdRing.classList.remove('hidden');
  els.holdRing.classList.add('running');
  els.ringFg.style.transitionDuration = `${total}ms`;
  requestAnimationFrame(() => { els.ringFg.style.strokeDashoffset = '0'; });
  let remaining = seconds;
  els.holdCount.textContent = remaining;
  holdTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      cancelHold();
      onDone();
    } else {
      els.holdCount.textContent = remaining;
    }
  }, 1000);
}

function cancelHold() {
  if (holdTimer) clearInterval(holdTimer);
  holdTimer = null;
  els.holdRing.classList.add('hidden');
  els.holdRing.classList.remove('running');
  els.ringFg.style.transitionDuration = '0ms';
  els.ringFg.style.strokeDashoffset = '326.7';
}

// ---- session recording ------------------------------------------------------
// One recording per ritual: starts when the visitor leaves the attract screen,
// saved only if they reached mahalo (abandoned runs are discarded).
function trackSession(stage) {
  if (stage.id === 'attract') {
    if (!recorder.active()) return;
    if (recorder.reachedStage('mahalo')) finalizeSession();
    else recorder.discard();
    return;
  }
  if (!recorder.active() && cameraStream) recorder.begin(cameraStream);
  recorder.mark(stage.id);
}

async function finalizeSession() {
  try {
    showSaveStatus('Saving your Breath of Aloha video…');
    if (recorder.active()) recorder.noteLabels(brands.snapshot());
    const { blob, meta } = await recorder.finish();
    const result = await window.kiosk.saveRecording(await blob.arrayBuffer(), meta);
    console.log('[recording]', result);
    showSaveStatus(
      result.uploaded
        ? 'Mahalo! Your session video is on its way to the Aloha Circle gallery.'
        : 'Mahalo! Your session video was saved on this kiosk.'
    );

    if (result.saved && typeof window.kiosk?.queueRecap === 'function') {
      window.kiosk.queueRecap(result.saved, meta).catch((err) => {
        console.warn('[recap] queue failed:', err);
      });
    }
  } catch (err) {
    console.warn('[recording] save failed:', err);
    showSaveStatus('');
  }
}

let saveStatusTimer = null;
function showSaveStatus(text) {
  if (!els.saveStatus) return;
  clearTimeout(saveStatusTimer);
  els.saveStatus.textContent = text;
  els.saveStatus.classList.toggle('hidden', !text);
  if (text) saveStatusTimer = setTimeout(() => els.saveStatus.classList.add('hidden'), 12000);
}

// ---- stage machine --------------------------------------------------------
function renderStage() {
  const stage = STAGES[stageIndex];
  cancelHold();
  pose.setExpected(stage.detect || null);
  armStallJudge();
  trackSession(stage);

  els.emoji.textContent = stage.emoji || '';
  els.title.textContent = stage.title;
  els.subtitle.textContent = stage.subtitle || '';
  els.instruction.textContent = stage.instruction || '';
  els.next.textContent = stage.button || 'Next';

  els.back.classList.toggle('hidden', stageIndex === 0);
  els.skip.classList.toggle('hidden', !['hold', 'gesture', 'avatar'].includes(stage.kind));

  playClip(stage.kind === 'attract' ? null : stage.clip);

  els.progress.innerHTML = STAGES.map((s, i) =>
    `<div class="dot ${i < stageIndex ? 'done' : i === stageIndex ? 'now' : ''}" title="${s.id}"></div>`
  ).join('');
}

function advance() {
  if (stageIndex < STAGES.length - 1) {
    stageIndex += 1;
  } else {
    stageIndex = 0; // mahalo -> start over
  }
  renderStage();
}

els.next.addEventListener('click', () => {
  const stage = STAGES[stageIndex];
  if (stage.kind === 'hold') {
    // Button still simulates the forehead touch when the detector misses.
    startHold(stage.holdSeconds, advance);
  } else {
    advance();
  }
});

els.skip.addEventListener('click', advance);
els.back.addEventListener('click', () => {
  if (stageIndex > 0) stageIndex -= 1;
  renderStage();
});

initAdminMode();
startCamera();
renderStage();
