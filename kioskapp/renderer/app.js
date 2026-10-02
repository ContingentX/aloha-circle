import { STAGES } from './stages.js';
import { MEDIA_BASE } from './config.js';
import { createPoseDetector } from './pose.js';
import { GESTURE_PROMPTS } from './gestures.js';
import { createSessionRecorder } from './recorder.js';
import { createAvatarPlacer, applyPlacement } from './avatarPlacement.js';

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
};

const startStage = new URLSearchParams(location.search).get('stage');
let stageIndex = Math.max(0, STAGES.findIndex((s) => s.id === startStage));
let holdTimer = null;
let stallTimer = null;
let cameraStream = null;
const pose = createPoseDetector();
const recorder = createSessionRecorder();
const avatarPlacer = createAvatarPlacer();

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
  } catch (err) {
    console.error('camera failed:', err);
    els.cameraError.classList.remove('hidden');
  }
}

function onPoseEvent(payload) {
  if (payload && payload.type === 'pose') {
    updateAvatarPlacement(payload.person, payload.video);
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

function armStallJudge() {
  clearTimeout(stallTimer);
  stallTimer = null;
  const stage = STAGES[stageIndex];
  if (!stage.detect || typeof window.kiosk?.judgeGesture !== 'function') return;
  stallTimer = setTimeout(async () => {
    const prompt = GESTURE_PROMPTS[stage.detect];
    if (!prompt || STAGES[stageIndex].id !== stage.id) return;
    try {
      const judge = await window.kiosk.judgeGesture(snapshot(els.camera), prompt);
      if (judge?.ok && STAGES[stageIndex].detect === stage.detect) {
        onPoseEvent({ type: 'gesture', event: stage.detect, source: 'cosmos' });
      }
    } catch (err) {
      console.warn('[cosmos] stall judge skipped', err);
    }
  }, 8000);
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

startCamera();
renderStage();
