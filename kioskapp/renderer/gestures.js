// Pure COCO-17 / MoveNet gesture predicates for the Breath of Aloha ritual.
// No DOM, no TF.js — unit-tested from Node. Scores below MIN_SCORE are treated
// as missing keypoints so a half-visible visitor does not false-trigger.

export const MIN_SCORE = 0.3;

// Wrists get a lower bar: raising hands to the face drops MoveNet's wrist
// confidence right when the ritual gestures need them most.
export const WRIST_MIN_SCORE = 0.2;

export const KP = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
};

const BY_NAME = {
  nose: 0,
  left_eye: 1,
  right_eye: 2,
  left_ear: 3,
  right_ear: 4,
  left_shoulder: 5,
  right_shoulder: 6,
  left_elbow: 7,
  right_elbow: 8,
  left_wrist: 9,
  right_wrist: 10,
  left_hip: 11,
  right_hip: 12,
};

/** Normalize pose-detection / RF-DETR / MoveNet keypoints into a 13-slot array. */
export function normalizeKeypoints(raw) {
  const out = new Array(13).fill(null);
  if (!raw) return out;
  for (const k of raw) {
    if (!k) continue;
    let idx = typeof k.index === 'number' ? k.index : undefined;
    if (idx === undefined && k.name) idx = BY_NAME[String(k.name).toLowerCase()];
    if (idx === undefined || idx > 12) continue;
    out[idx] = {
      x: Number(k.x),
      y: Number(k.y),
      score: k.score == null ? 1 : Number(k.score),
    };
  }
  return out;
}

function pt(kp, i) {
  const k = kp[i];
  if (!k || k.score < MIN_SCORE || !Number.isFinite(k.x) || !Number.isFinite(k.y)) return null;
  return k;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function shoulderWidth(kp) {
  const l = pt(kp, KP.leftShoulder);
  const r = pt(kp, KP.rightShoulder);
  if (!l || !r) return null;
  const w = dist(l, r);
  return w > 1 ? w : null;
}

export function faceBox(kp) {
  const parts = [
    pt(kp, KP.nose),
    pt(kp, KP.leftEye),
    pt(kp, KP.rightEye),
    pt(kp, KP.leftEar),
    pt(kp, KP.rightEar),
  ].filter(Boolean);
  if (parts.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of parts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.max(12, (maxX - minX) * 0.35);
  const x = minX - pad;
  const y = minY - pad;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2.4;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, area: w * h };
}

export function personBoundingBox(kp, video = { width: 640, height: 480 }) {
  const bodyParts = [
    pt(kp, KP.nose),
    pt(kp, KP.leftEye),
    pt(kp, KP.rightEye),
    pt(kp, KP.leftEar),
    pt(kp, KP.rightEar),
    pt(kp, KP.leftShoulder),
    pt(kp, KP.rightShoulder),
    pt(kp, KP.leftElbow),
    pt(kp, KP.rightElbow),
    pt(kp, KP.leftWrist),
    pt(kp, KP.rightWrist),
    pt(kp, KP.leftHip),
    pt(kp, KP.rightHip),
  ].filter(Boolean);
  if (bodyParts.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of bodyParts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const padX = Math.max(20, width * 0.15);
  const padY = Math.max(20, height * 0.1);

  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const w = Math.min(video.width - x, width + padX * 2);
  const h = Math.min(video.height - y, height + padY * 2);

  const frameFill = (w * h) / (video.width * video.height);

  return {
    x, y, w, h,
    cx: x + w / 2,
    cy: y + h / 2,
    area: w * h,
    frameFill,
  };
}

export function isGazeAtScreen(kp, video) {
  const le = pt(kp, KP.leftEye);
  const re = pt(kp, KP.rightEye);
  const nose = pt(kp, KP.nose);
  if (!le || !re || !nose) return false;
  const eyeSpan = dist(le, re);
  if (eyeSpan < 8) return false;
  // Head yaw ~0: nose sits between the eyes.
  const minX = Math.min(le.x, re.x);
  const maxX = Math.max(le.x, re.x);
  if (nose.x < minX || nose.x > maxX) return false;
  const box = faceBox(kp);
  if (!box || !video) return true;
  return box.h / video.height > 0.12;
}

export function isForeheadTouch(kp, video) {
  const box = faceBox(kp);
  if (!box || !video || video.width < 1 || video.height < 1) return false;
  // Lean-in: face fills a large fraction of the frame (forehead rest on bezel).
  return box.h / video.height > 0.42 || box.area / (video.width * video.height) > 0.18;
}

function wristPt(kp, i) {
  const k = kp[i];
  if (!k || k.score < WRIST_MIN_SCORE || !Number.isFinite(k.x) || !Number.isFinite(k.y)) return null;
  return k;
}

function bothWrists(kp) {
  const lw = wristPt(kp, KP.leftWrist);
  const rw = wristPt(kp, KP.rightWrist);
  return lw && rw ? [lw, rw] : null;
}

// Best available face anchor. Touching the face usually occludes the exact
// keypoint being blessed (eyes, nose), so every face predicate needs a
// fallback anchor rather than failing when its target keypoint disappears.
function faceMid(kp) {
  const le = pt(kp, KP.leftEye);
  const re = pt(kp, KP.rightEye);
  if (le && re) return { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
  const nose = pt(kp, KP.nose);
  if (nose) return { x: nose.x, y: nose.y };
  const la = pt(kp, KP.leftEar);
  const ra = pt(kp, KP.rightEar);
  if (la && ra) return { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2 };
  return null;
}

function wristsNear(wrists, leftTarget, rightTarget, radius) {
  if (!wrists || !leftTarget || !rightTarget) return false;
  const [lw, rw] = wrists;
  const a = dist(lw, leftTarget) < radius && dist(rw, rightTarget) < radius;
  const b = dist(lw, rightTarget) < radius && dist(rw, leftTarget) < radius;
  return a || b;
}

export function isHandsOverEyes(kp) {
  const wrists = bothWrists(kp);
  const mid = faceMid(kp);
  if (!wrists || !mid) return false;
  const scale = shoulderWidth(kp) || 80;
  const [lw, rw] = wrists;
  // Clustered at the face center. Spread wrists belong to the ears blessing —
  // wrist separation, not eye visibility, is what keeps the two apart.
  if (dist(lw, rw) > scale * 0.5) return false;
  return wrists.every((w) => dist(w, mid) < scale * 0.45);
}

export function isHandsOverEars(kp) {
  if (isHandsOverEyes(kp)) return false;
  const wrists = bothWrists(kp);
  if (!wrists) return false;
  const scale = shoulderWidth(kp) || 80;
  const le = pt(kp, KP.leftEar) || pt(kp, KP.leftEye);
  const re = pt(kp, KP.rightEar) || pt(kp, KP.rightEye);
  if (wristsNear(wrists, le, re, scale * 0.55)) return true;
  // Palms over the ears hide the ear keypoints themselves: accept spread
  // wrists flanking the face at head height.
  const mid = faceMid(kp);
  if (!mid) return false;
  const [lw, rw] = wrists;
  const flanking = (lw.x - mid.x) * (rw.x - mid.x) < 0 && dist(lw, rw) >= scale * 0.5;
  const nearHead = wrists.every(
    (w) => Math.abs(w.y - mid.y) < scale * 0.5 && Math.abs(w.x - mid.x) < scale * 0.8
  );
  return flanking && nearHead;
}

export function isHandNearNose(kp) {
  // Touching the nose often hides it — fall back to the face anchor.
  const target = pt(kp, KP.nose) || faceMid(kp);
  const lw = wristPt(kp, KP.leftWrist);
  const rw = wristPt(kp, KP.rightWrist);
  if (!target) return false;
  const scale = shoulderWidth(kp) || 80;
  const r = scale * 0.5;
  return (lw && dist(lw, target) < r) || (rw && dist(rw, target) < r);
}

export function isHandsOnHeart(kp) {
  const ls = pt(kp, KP.leftShoulder);
  const rs = pt(kp, KP.rightShoulder);
  const lh = pt(kp, KP.leftHip);
  const rh = pt(kp, KP.rightHip);
  const lw = wristPt(kp, KP.leftWrist);
  const rw = wristPt(kp, KP.rightWrist);
  if (!ls || !rs) return false;
  // Stacked hands occlude one wrist — require every *visible* wrist on the
  // chest instead of demanding both be tracked.
  const visible = [lw, rw].filter(Boolean);
  if (visible.length === 0) return false;
  const minX = Math.min(ls.x, rs.x);
  const maxX = Math.max(ls.x, rs.x);
  const shoulderY = (ls.y + rs.y) / 2;
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : shoulderY + (shoulderWidth(kp) || 80) * 1.6;
  const top = shoulderY;
  const bottom = shoulderY + (hipY - shoulderY) * 0.55;
  const inChest = (w) => w.x >= minX && w.x <= maxX && w.y >= top && w.y <= bottom;
  return visible.every(inChest);
}

/**
 * Classify the current pose. Returns at most one ritual event, preferring the
 * more specific gesture over gaze when both would match.
 */
export function classifyGesture(rawKeypoints, video = { width: 640, height: 480 }) {
  const kp = Array.isArray(rawKeypoints) && rawKeypoints.length === 13 && !rawKeypoints[0]?.name
    ? rawKeypoints
    : normalizeKeypoints(rawKeypoints);
  const face = faceBox(kp);
  const person = personBoundingBox(kp, video);
  const result = { event: null, face, person, keypoints: kp };

  if (isHandsOverEyes(kp)) result.event = 'hands_over_eyes';
  else if (isHandsOverEars(kp)) result.event = 'hands_over_ears';
  else if (isHandNearNose(kp)) result.event = 'hand_near_nose';
  else if (isHandsOnHeart(kp)) result.event = 'hands_on_heart';
  else if (isForeheadTouch(kp, video)) result.event = 'forehead_touch';
  else if (isGazeAtScreen(kp, video)) result.event = 'gaze_at_screen';

  return result;
}

export function createDwellTracker({ frames = 15 } = {}) {
  const counts = Object.create(null);
  return {
    tick(event) {
      // A missed frame decays progress instead of zeroing it: MoveNet flickers
      // for a frame or two mid-gesture, and a hard reset meant visitors could
      // hold a pose forever without ever reaching the dwell threshold.
      if (!event) {
        for (const k of Object.keys(counts)) counts[k] = Math.max(0, counts[k] - 1);
        return null;
      }
      counts[event] = (counts[event] || 0) + 1;
      for (const k of Object.keys(counts)) {
        if (k !== event) counts[k] = Math.max(0, counts[k] - 1);
      }
      if (counts[event] >= frames) {
        counts[event] = 0;
        return event;
      }
      return null;
    },
    progress(event) {
      if (!event) return 0;
      return Math.min(1, (counts[event] || 0) / frames);
    },
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
  };
}

export const GESTURE_PROMPTS = {
  gaze_at_screen: 'Is a person looking toward the camera with their face clearly visible? Answer YES or NO only.',
  forehead_touch: 'Is the person leaning their forehead very close to the camera, filling much of the frame? Answer YES or NO only.',
  hands_over_eyes: 'Is the person covering or touching both eyelids with their hands? Answer YES or NO only.',
  hands_over_ears: 'Is the person covering both ears with their hands? Answer YES or NO only.',
  hand_near_nose: 'Is the person touching or holding a hand near their nose? Answer YES or NO only.',
  hands_on_heart: 'Is the person stacking both hands over the center of their chest? Answer YES or NO only.',
};
