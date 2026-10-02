import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KP,
  classifyGesture,
  createDwellTracker,
  isForeheadTouch,
  isGazeAtScreen,
  isHandNearNose,
  isHandsOnHeart,
  isHandsOverEars,
  isHandsOverEyes,
  normalizeKeypoints,
} from '../renderer/gestures.js';

const VIDEO = { width: 640, height: 480 };

function blank() {
  return new Array(13).fill(null);
}

function set(kp, i, x, y, score = 0.9) {
  kp[i] = { x, y, score };
}

/** Upright visitor, mid-frame, ~100px shoulders, face around y=110. */
function standing() {
  const kp = blank();
  set(kp, KP.nose, 320, 120);
  set(kp, KP.leftEye, 300, 100);
  set(kp, KP.rightEye, 340, 100);
  set(kp, KP.leftEar, 280, 110);
  set(kp, KP.rightEar, 360, 110);
  set(kp, KP.leftShoulder, 260, 200);
  set(kp, KP.rightShoulder, 380, 200);
  set(kp, KP.leftElbow, 230, 280);
  set(kp, KP.rightElbow, 410, 280);
  set(kp, KP.leftWrist, 220, 360);
  set(kp, KP.rightWrist, 420, 360);
  set(kp, KP.leftHip, 280, 380);
  set(kp, KP.rightHip, 360, 380);
  return kp;
}

test('normalizeKeypoints maps MoveNet names into COCO-17 slots', () => {
  const kp = normalizeKeypoints([
    { name: 'nose', x: 1, y: 2, score: 0.8 },
    { name: 'left_wrist', x: 3, y: 4, score: 0.7 },
  ]);
  assert.equal(kp[KP.nose].x, 1);
  assert.equal(kp[KP.leftWrist].y, 4);
  assert.equal(kp[KP.rightEye], null);
});

test('gaze_at_screen fires for a facing visitor, not a profile', () => {
  const facing = standing();
  assert.equal(isGazeAtScreen(facing, VIDEO), true);
  assert.equal(classifyGesture(facing, VIDEO).event, 'gaze_at_screen');

  const profile = standing();
  profile[KP.nose].x = 400; // nose past the right eye → yaw
  assert.equal(isGazeAtScreen(profile, VIDEO), false);
});

test('forehead_touch requires a near-field face', () => {
  const far = standing();
  assert.equal(isForeheadTouch(far, VIDEO), false);

  const close = standing();
  // Stretch the face vertically as if leaning into the bezel.
  close[KP.nose].y = 220;
  close[KP.leftEye].y = 40;
  close[KP.rightEye].y = 40;
  close[KP.leftEar].y = 80;
  close[KP.rightEar].y = 80;
  assert.equal(isForeheadTouch(close, VIDEO), true);
  assert.equal(classifyGesture(close, VIDEO).event, 'forehead_touch');
});

test('hands_over_eyes: both wrists near the eyes', () => {
  const kp = standing();
  kp[KP.leftWrist] = { x: 300, y: 100, score: 0.9 };
  kp[KP.rightWrist] = { x: 340, y: 100, score: 0.9 };
  assert.equal(isHandsOverEyes(kp), true);
  assert.equal(classifyGesture(kp, VIDEO).event, 'hands_over_eyes');
});

test('hands_over_ears: both wrists near the ears', () => {
  const kp = standing();
  kp[KP.leftWrist] = { x: 280, y: 110, score: 0.9 };
  kp[KP.rightWrist] = { x: 360, y: 110, score: 0.9 };
  assert.equal(isHandsOverEars(kp), true);
  assert.equal(classifyGesture(kp, VIDEO).event, 'hands_over_ears');
});

test('hand_near_nose: either wrist at the nose', () => {
  const kp = standing();
  kp[KP.rightWrist] = { x: 320, y: 120, score: 0.9 };
  assert.equal(isHandNearNose(kp), true);
  assert.equal(classifyGesture(kp, VIDEO).event, 'hand_near_nose');
});

test('hands_on_heart: both wrists stacked on the upper chest', () => {
  const kp = standing();
  kp[KP.leftWrist] = { x: 300, y: 250, score: 0.9 };
  kp[KP.rightWrist] = { x: 340, y: 260, score: 0.9 };
  assert.equal(isHandsOnHeart(kp), true);
  assert.equal(classifyGesture(kp, VIDEO).event, 'hands_on_heart');
});

test('low-score wrists do not trigger a blessing', () => {
  const kp = standing();
  kp[KP.leftWrist] = { x: 300, y: 100, score: 0.05 };
  kp[KP.rightWrist] = { x: 340, y: 100, score: 0.05 };
  assert.equal(isHandsOverEyes(kp), false);
});

test('dwell tracker needs consecutive frames and resets on a miss', () => {
  const dwell = createDwellTracker({ frames: 3 });
  assert.equal(dwell.tick('hands_over_eyes'), null);
  assert.equal(dwell.tick('hands_over_eyes'), null);
  assert.equal(dwell.tick(null), null);
  assert.equal(dwell.tick('hands_over_eyes'), null);
  assert.equal(dwell.tick('hands_over_eyes'), null);
  assert.equal(dwell.tick('hands_over_eyes'), 'hands_over_eyes');
});
