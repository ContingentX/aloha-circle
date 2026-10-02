import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/sequences.json'), 'utf8'));

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

test('dwell tracker decays on a missed frame instead of resetting', () => {
  const dwell = createDwellTracker({ frames: 3 });
  assert.equal(dwell.tick('hands_over_eyes'), null); // 1
  assert.equal(dwell.tick('hands_over_eyes'), null); // 2
  assert.equal(dwell.tick(null), null); // decay -> 1
  assert.equal(dwell.tick('hands_over_eyes'), null); // 2
  assert.equal(dwell.tick('hands_over_eyes'), 'hands_over_eyes'); // 3 fires
});

test('dwell tracker drains to zero over sustained misses', () => {
  const dwell = createDwellTracker({ frames: 3 });
  dwell.tick('hands_over_eyes');
  dwell.tick('hands_over_eyes');
  dwell.tick(null);
  dwell.tick(null);
  assert.equal(dwell.progress('hands_over_eyes'), 0);
});

test('hands_over_eyes still fires when the covered eyes are untracked', () => {
  const kp = standing();
  kp[KP.leftEye] = null; // palms hide the eye keypoints themselves
  kp[KP.rightEye] = null;
  kp[KP.leftWrist] = { x: 310, y: 115, score: 0.25 }; // occlusion-degraded scores
  kp[KP.rightWrist] = { x: 330, y: 115, score: 0.25 };
  assert.equal(isHandsOverEyes(kp), true);
});

test('hands_over_ears still fires when palms hide the ear keypoints', () => {
  const kp = standing();
  kp[KP.leftEar] = null;
  kp[KP.rightEar] = null;
  kp[KP.leftEye] = null;
  kp[KP.rightEye] = null;
  kp[KP.leftWrist] = { x: 275, y: 115, score: 0.9 };
  kp[KP.rightWrist] = { x: 365, y: 115, score: 0.9 };
  assert.equal(isHandsOverEars(kp), true);
});

test('hand_near_nose still fires when the touch hides the nose', () => {
  const kp = standing();
  kp[KP.nose] = null;
  kp[KP.rightWrist] = { x: 322, y: 110, score: 0.9 };
  assert.equal(isHandNearNose(kp), true);
});

test('hands_on_heart fires when stacking occludes one wrist', () => {
  const kp = standing();
  kp[KP.leftWrist] = null; // hidden under the stacked hand
  kp[KP.rightWrist] = { x: 320, y: 255, score: 0.9 };
  assert.equal(isHandsOnHeart(kp), true);
  assert.equal(classifyGesture(kp, VIDEO).event, 'hands_on_heart');
});

test('hands at the sides never read as hands_on_heart', () => {
  const kp = standing(); // wrists hang at y=360, below the chest band
  assert.equal(isHandsOnHeart(kp), false);
});

// ---------------------------------------------------------------------------
// Fixture-mode tests: replay recorded keypoint sequences through predicates
// ---------------------------------------------------------------------------

function frameToKeypoints(frame) {
  if (!frame || !frame.kp) return blank();
  const kp = blank();
  const mapping = {
    nose: KP.nose,
    leftEye: KP.leftEye,
    rightEye: KP.rightEye,
    leftEar: KP.leftEar,
    rightEar: KP.rightEar,
    leftShoulder: KP.leftShoulder,
    rightShoulder: KP.rightShoulder,
    leftElbow: KP.leftElbow,
    rightElbow: KP.rightElbow,
    leftWrist: KP.leftWrist,
    rightWrist: KP.rightWrist,
    leftHip: KP.leftHip,
    rightHip: KP.rightHip,
  };
  for (const [name, coords] of Object.entries(frame.kp)) {
    const idx = mapping[name];
    if (idx !== undefined && coords !== null) {
      set(kp, idx, coords[0], coords[1], 0.9);
    }
  }
  return kp;
}

describe('fixture sequences', () => {
  const video = fixtures.video;

  test('gaze_at_screen sequence', () => {
    const seq = fixtures.sequences.gaze_at_screen;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected gaze_at_screen');
    }
  });

  test('forehead_touch sequence', () => {
    const seq = fixtures.sequences.forehead_touch;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected forehead_touch');
    }
  });

  test('hands_over_eyes sequence', () => {
    const seq = fixtures.sequences.hands_over_eyes;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected hands_over_eyes');
    }
  });

  test('hands_over_ears sequence', () => {
    const seq = fixtures.sequences.hands_over_ears;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected hands_over_ears');
    }
  });

  test('hand_near_nose sequence', () => {
    const seq = fixtures.sequences.hand_near_nose;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected hand_near_nose');
    }
  });

  test('hands_on_heart sequence', () => {
    const seq = fixtures.sequences.hands_on_heart;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'expected hands_on_heart');
    }
  });

  test('transition sequence: gaze → hands_over_eyes', () => {
    const seq = fixtures.sequences.transition_gaze_to_eyes;
    const expectedEvents = seq.expectedEvents;
    for (let i = 0; i < seq.frames.length; i++) {
      const kp = frameToKeypoints(seq.frames[i]);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, expectedEvents[i], `frame ${i}: expected ${expectedEvents[i]}`);
    }
  });

  test('noisy sequence: gesture changes when wrists lost', () => {
    const seq = fixtures.sequences.noisy_hands_over_eyes;
    const expectedEvents = seq.expectedEvents;
    for (let i = 0; i < seq.frames.length; i++) {
      const kp = frameToKeypoints(seq.frames[i]);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, expectedEvents[i], `frame ${i}: expected ${expectedEvents[i]}`);
    }
  });

  test('profile should not trigger gaze_at_screen', () => {
    const seq = fixtures.sequences.profile_no_gaze;
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, video);
      assert.equal(result.event, seq.expectedEvent, 'profile should not trigger gaze');
    }
  });
});

describe('dwell with fixture sequences', () => {
  test('hands_over_eyes triggers after 3 consecutive frames', () => {
    const seq = fixtures.sequences.hands_over_eyes;
    const dwell = createDwellTracker({ frames: 3 });
    const events = [];
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, fixtures.video);
      const fired = dwell.tick(result.event);
      events.push(fired);
    }
    assert.equal(events[0], null);
    assert.equal(events[1], null);
    assert.equal(events[2], 'hands_over_eyes');
  });

  test('noisy sequence resets dwell when gesture changes', () => {
    const seq = fixtures.sequences.noisy_hands_over_eyes;
    const dwell = createDwellTracker({ frames: 3 });
    const eyesProgress = [];
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, fixtures.video);
      dwell.tick(result.event);
      eyesProgress.push(dwell.progress('hands_over_eyes'));
    }
    assert.equal(eyesProgress[0] > 0, true, 'frame 0 should accumulate hands_over_eyes');
    assert.equal(eyesProgress[1], 0, 'frame 1 (gaze) should reset hands_over_eyes dwell');
    assert.equal(eyesProgress[2] > 0, true, 'frame 2 should start fresh');
  });

  test('full ritual transition with dwell', () => {
    const seq = fixtures.sequences.transition_gaze_to_eyes;
    const dwell = createDwellTracker({ frames: 2 });
    let gazeFired = false;
    let eyesFired = false;
    
    for (const frame of seq.frames) {
      const kp = frameToKeypoints(frame);
      const result = classifyGesture(kp, fixtures.video);
      const fired = dwell.tick(result.event);
      if (fired === 'gaze_at_screen') gazeFired = true;
      if (fired === 'hands_over_eyes') eyesFired = true;
    }
    
    assert.equal(gazeFired, true, 'gaze should have fired during sequence');
    assert.equal(eyesFired, true, 'hands_over_eyes should have fired during sequence');
  });
});
