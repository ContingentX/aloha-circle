import { STAGES } from './stages.js';
import { MEDIA_BASE } from './config.js';
import { createPoseDetector } from './pose.js';
import { GESTURE_PROMPTS } from './gestures.js';
import { createSessionRecorder } from './recorder.js';
import { createAvatarPlacer, applyPlacement } from './avatarPlacement.js';
import { initAdminMode } from './adminMode.js';
import { initBrandPanel } from './brandPanel.js';
import { LOCALS, EXPERIENCES } from './matchData.js';
import { pickMatch } from './matching.js';
import { buildWheelSvg, spinOutcome, createGrabSpinGesture } from './wheel.js';

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
  wheelArea: $('wheel-area'),
  wheelSvg: $('wheel-svg'),
  wheelHint: $('wheel-hint'),
  matchCard: $('match-card'),
  matchPhoto: $('match-photo'),
  matchInitial: $('match-initial'),
  matchName: $('match-name'),
  matchBlurb: $('match-blurb'),
  matchReasons: $('match-reasons'),
  matchPrize: $('match-prize'),
  claimForm: $('claim-form'),
  claimEmail: $('claim-email'),
  claimQr: $('claim-qr'),
  claimQrWrap: $('claim-qr-wrap'),
  claimDone: $('claim-done'),
};

const startStage = new URLSearchParams(location.search).get('stage');
let stageIndex = Math.max(0, STAGES.findIndex((s) => s.id === startStage));
let holdTimer = null;
let stallTimer = null;
let cameraStream = null;
const pose = createPoseDetector();
const recorder = createSessionRecorder();
const avatarPlacer = createAvatarPlacer();
const brandPanel = initBrandPanel();
brandPanel.setReport({ brands: [] });
let liveLabels = [];
let brandReport = null;
let brandTimer = null;

function paintBrands() {
  const report = {
    brands: brandReport?.brands || [],
    clothingStyle: brandReport?.clothingStyle || [],
    colors: brandReport?.colors || [],
    accessories: brandReport?.accessories || [],
    labels: liveLabels,
  };
  brandPanel.setReport(report);
  if (recorder.active()) {
    recorder.noteLabels([
      ...report.brands.map((name) => ({ name, kind: 'brand' })),
      ...liveLabels.map((name) => ({ name, kind: 'label' })),
    ]);
  }
}

async function pollBrands() {
  if (typeof window.kiosk?.analyzeBrands !== 'function') return;
  if (!els.camera.videoWidth) return;
  try {
    const result = await window.kiosk.analyzeBrands(snapshot(els.camera));
    if (result?.ok && result.report) {
      brandReport = result.report;
      paintBrands();
    }
  } catch (err) {
    console.warn('[brands] analyze skipped', err);
  }
}

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
    clearInterval(brandTimer);
    brandTimer = setInterval(pollBrands, 8000);
    pollBrands();
  } catch (err) {
    console.error('camera failed:', err);
    els.cameraError.classList.remove('hidden');
  }
}

function onPoseEvent(payload) {
  if (payload && payload.type === 'pose') {
    updateAvatarPlacement(payload.person, payload.video);
    feedWheelGesture(payload);
    liveLabels = [];
    if (payload.person) liveLabels.push('person');
    if (payload.event) liveLabels.push(payload.event);
    paintBrands();
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
    if (recorder.active()) {
      if (recorder.reachedStage('mahalo')) finalizeSession();
      else recorder.discard();
    }
    resetMatchFlow();
    return;
  }
  if (!recorder.active() && cameraStream) recorder.begin(cameraStream);
  recorder.mark(stage.id);
}

async function finalizeSession() {
  // Snapshot before any await — trackSession resets the match flow right
  // after calling us, while we are still waiting on the recorder.
  const wheel = wheelResult;
  const match = matchResult
    ? { localId: matchResult.local.id, score: matchResult.score, reasons: matchResult.reasons }
    : null;
  const claim = claimInfo;
  try {
    showSaveStatus('Saving your Breath of Aloha video…');
    if (recorder.active()) {
      recorder.noteLabels([
        ...(brandReport?.brands || []).map((name) => ({ name, kind: 'brand' })),
        ...liveLabels.map((name) => ({ name, kind: 'label' })),
      ]);
    }
    const { blob, meta } = await recorder.finish();
    if (brandReport) meta.brandReport = brandReport;
    if (wheel) meta.wheel = wheel;
    if (match) meta.match = match;
    // Claim email stays in the local sidecar only — recordings.cjs uploads
    // the video, never the JSON, so visitor PII does not leave the kiosk.
    if (claim) meta.claim = claim;
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

// ---- wheel of aloha ---------------------------------------------------------
// Spun by the grab-and-pull gesture (wrist tracked by the same pose loop as
// the ritual) or the Spin button. Landing picks the sponsor experience.
const wheelGesture = createGrabSpinGesture();
let wheelAngle = 0;
let wheelSpinning = false;
let wheelResult = null;
let matchResult = null;
let claimInfo = null;
let claimNonce = null;

function currentStage() {
  return STAGES[stageIndex];
}

function feedWheelGesture(payload) {
  if (currentStage().kind !== 'wheel' || wheelSpinning || wheelResult) return;
  const fired = wheelGesture.feed(payload.keypoints, payload.video);
  if (!fired) return;
  if (fired.type === 'grab') {
    els.wheelArea.classList.add('grabbed');
    els.wheelHint.textContent = 'Got it — now pull down fast!';
    return;
  }
  if (fired.type === 'spin') spinWheel(fired.velocity, 'gesture');
}

function spinWheel(velocity, source) {
  if (wheelSpinning || wheelResult) return;
  wheelSpinning = true;
  els.wheelArea.classList.remove('grabbed');
  els.wheelArea.classList.add('spinning');
  els.wheelHint.textContent = '';
  els.next.disabled = true;

  const outcome = spinOutcome(velocity, { segments: EXPERIENCES.length, startAngle: wheelAngle });
  wheelAngle = outcome.finalAngle;
  const rotor = els.wheelSvg.querySelector('#wheel-rotor');
  if (rotor) {
    // easeOutQuad ≈ constant deceleration, matching spinOutcome's physics.
    rotor.style.transition = `transform ${outcome.durationMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
    rotor.style.transform = `rotate(${outcome.finalAngle}deg)`;
  }
  setTimeout(() => {
    const experience = EXPERIENCES[outcome.index];
    wheelResult = { experienceId: experience.id, title: experience.title, velocity, source };
    els.wheelHint.textContent = `\u{1F33A} ${experience.title}!`;
    els.next.disabled = false;
    wheelSpinning = false;
    setTimeout(() => {
      if (currentStage().kind === 'wheel') advance();
    }, 1600);
  }, outcome.durationMs + 120);
}

function renderWheelStage(active) {
  els.wheelArea.classList.toggle('hidden', !active);
  if (!active) return;
  if (!els.wheelSvg.innerHTML) els.wheelSvg.innerHTML = buildWheelSvg(EXPERIENCES);
  wheelGesture.reset();
  // The hint pill is the live coach line; the footer instruction would sit
  // right under it and double it, so the wheel stage leaves the footer empty.
  els.instruction.textContent = '';
  if (!wheelResult) {
    els.wheelHint.textContent = 'Reach up ↑ grab the top of the wheel, then pull down fast!';
  }
}

// ---- match reveal + claim ---------------------------------------------------
function renderMatchStage(active) {
  els.matchCard.classList.toggle('hidden', !active);
  if (!active) return;
  // The card is self-explanatory; the footer line would run underneath it.
  els.instruction.textContent = '';
  if (!matchResult) {
    matchResult = pickMatch(brandReport, LOCALS, {
      seed: Math.floor(Math.random() * LOCALS.length),
    });
  }
  if (!matchResult) return;
  const { local, reasons } = matchResult;

  els.matchName.textContent = local.name;
  els.matchBlurb.textContent = local.blurb;
  els.matchInitial.textContent = local.name[0] || '?';
  els.matchPhoto.classList.remove('hidden');
  els.matchPhoto.onerror = () => els.matchPhoto.classList.add('hidden');
  els.matchPhoto.src = `${MEDIA_BASE}/locals/${local.id}.jpg`;

  els.matchReasons.textContent = '';
  const lines = reasons.length ? reasons : ['a fresh connection — no shared brands needed'];
  for (const reason of lines) {
    const li = document.createElement('li');
    li.textContent = reason;
    els.matchReasons.appendChild(li);
  }
  els.matchPrize.textContent = wheelResult
    ? `You won: ${wheelResult.title} — together with ${local.name}`
    : `An experience to share with ${local.name}`;

  claimNonce = claimNonce || crypto.randomUUID().slice(0, 8);
  const claimUrl =
    'https://aloha-circle.com/claim' +
    `?x=${claimNonce}&e=${wheelResult?.experienceId || 'aloha'}&l=${local.id}`;
  // QR lib (qrcodejs) loads from CDN; if venue Wi-Fi dropped it, degrade to
  // the email path quietly.
  if (typeof window.QRCode === 'function') {
    els.claimQr.textContent = '';
    new window.QRCode(els.claimQr, { text: claimUrl, width: 110, height: 110 });
    els.claimQrWrap.classList.remove('hidden');
  } else {
    els.claimQrWrap.classList.add('hidden');
  }
}

els.claimForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = els.claimEmail.value.trim();
  if (!email) return;
  claimInfo = {
    email,
    nonce: claimNonce,
    experienceId: wheelResult?.experienceId || null,
    localId: matchResult?.local?.id || null,
    at: new Date().toISOString(),
  };
  els.claimForm.classList.add('hidden');
  els.claimDone.textContent = `Mahalo! We’ll email your prize details to ${email}.`;
  els.claimDone.classList.remove('hidden');
});

function resetMatchFlow() {
  wheelGesture.reset();
  wheelSpinning = false;
  wheelResult = null;
  matchResult = null;
  claimInfo = null;
  claimNonce = null;
  els.next.disabled = false;
  els.wheelArea.classList.remove('grabbed', 'spinning');
  els.claimEmail.value = '';
  els.claimForm.classList.remove('hidden');
  els.claimDone.classList.add('hidden');
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
  els.skip.classList.toggle('hidden', !['hold', 'gesture', 'avatar', 'wheel', 'match'].includes(stage.kind));

  renderWheelStage(stage.kind === 'wheel');
  renderMatchStage(stage.kind === 'match');
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
  } else if (stage.kind === 'wheel' && !wheelResult) {
    // Button fallback when the grab gesture misses — random brisk pull.
    spinWheel(600 + Math.random() * 500, 'button');
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
