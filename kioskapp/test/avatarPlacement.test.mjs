import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAvatarPosition,
  createAvatarPlacer,
  rectsIntersect,
  normalizePersonBox,
  getAvatarRect,
} from '../renderer/avatarPlacement.js';
import { personBoundingBox, KP } from '../renderer/gestures.js';

const VIEWPORT = { width: 1920, height: 1080 };

function blank() {
  return new Array(13).fill(null);
}

function set(kp, i, x, y, score = 0.9) {
  kp[i] = { x, y, score };
}

function standing(cx = 960, scale = 1) {
  const kp = blank();
  const offset = cx - 960;
  set(kp, KP.nose, 320 * scale + offset + 640, 120 * scale);
  set(kp, KP.leftEye, 300 * scale + offset + 640, 100 * scale);
  set(kp, KP.rightEye, 340 * scale + offset + 640, 100 * scale);
  set(kp, KP.leftEar, 280 * scale + offset + 640, 110 * scale);
  set(kp, KP.rightEar, 360 * scale + offset + 640, 110 * scale);
  set(kp, KP.leftShoulder, 260 * scale + offset + 640, 200 * scale);
  set(kp, KP.rightShoulder, 380 * scale + offset + 640, 200 * scale);
  set(kp, KP.leftElbow, 230 * scale + offset + 640, 280 * scale);
  set(kp, KP.rightElbow, 410 * scale + offset + 640, 280 * scale);
  set(kp, KP.leftWrist, 220 * scale + offset + 640, 360 * scale);
  set(kp, KP.rightWrist, 420 * scale + offset + 640, 360 * scale);
  set(kp, KP.leftHip, 280 * scale + offset + 640, 380 * scale);
  set(kp, KP.rightHip, 360 * scale + offset + 640, 380 * scale);
  return kp;
}

test('personBoundingBox computes full body bounds from keypoints', () => {
  const kp = standing(960, 1);
  const box = personBoundingBox(kp, VIEWPORT);
  assert.ok(box, 'should return a bounding box');
  assert.ok(box.w > 100, 'box should have significant width');
  assert.ok(box.h > 200, 'box should have significant height');
  assert.ok(box.cx > 800 && box.cx < 1200, 'center should be near middle');
  assert.ok(box.frameFill >= 0 && box.frameFill <= 1, 'frameFill should be normalized');
});

test('personBoundingBox returns null with insufficient keypoints', () => {
  const kp = blank();
  set(kp, KP.nose, 320, 120);
  const box = personBoundingBox(kp, VIEWPORT);
  assert.equal(box, null, 'should return null with < 3 keypoints');
});

test('calculateAvatarPosition places avatar on right by default', () => {
  const position = calculateAvatarPosition(null, VIEWPORT, 'right');
  assert.equal(position.side, 'right');
  assert.equal(position.scale, 1);
});

test('calculateAvatarPosition moves avatar left when person appears on screen right (low video cx)', () => {
  const kp = standing(400, 1);
  const personBox = personBoundingBox(kp, VIEWPORT);
  const position = calculateAvatarPosition(personBox, VIEWPORT, 'right');
  assert.equal(position.side, 'left', 'should move to left when person appears on screen right');
});

test('calculateAvatarPosition keeps avatar right when person appears on screen left (high video cx)', () => {
  const kp = standing(1500, 1);
  const personBox = personBoundingBox(kp, VIEWPORT);
  const position = calculateAvatarPosition(personBox, VIEWPORT, 'left');
  assert.equal(position.side, 'right', 'should move to right when person appears on screen left');
});

test('calculateAvatarPosition scales down when person fills frame', () => {
  const kp = standing(960, 3);
  const personBox = personBoundingBox(kp, VIEWPORT);
  personBox.frameFill = 0.5;
  const position = calculateAvatarPosition(personBox, VIEWPORT, 'right');
  assert.ok(position.scale < 1, 'should scale down when person fills >35% of frame');
  assert.ok(position.scale >= 0.65, 'should not scale below 0.65');
});

test('rectsIntersect detects overlapping rectangles', () => {
  const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
  const b = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  assert.ok(rectsIntersect(a, b), 'overlapping rects should intersect');
});

test('rectsIntersect returns false for non-overlapping rectangles', () => {
  const a = { x: 0, y: 0, w: 0.3, h: 0.3 };
  const b = { x: 0.5, y: 0.5, w: 0.3, h: 0.3 };
  assert.ok(!rectsIntersect(a, b), 'non-overlapping rects should not intersect');
});

test('rectsIntersect handles null inputs', () => {
  assert.ok(!rectsIntersect(null, { x: 0, y: 0, w: 1, h: 1 }));
  assert.ok(!rectsIntersect({ x: 0, y: 0, w: 1, h: 1 }, null));
});

test('createAvatarPlacer debounces updates at ~5 Hz', () => {
  const placer = createAvatarPlacer({ intervalMs: 200 });
  const kp = standing(1500, 1);
  const personBox = personBoundingBox(kp, VIEWPORT);

  const first = placer.update(personBox, VIEWPORT, 0);
  assert.ok(first, 'first update should return position');

  const second = placer.update(personBox, VIEWPORT, 100);
  assert.equal(second, null, 'update within interval should be debounced');

  const third = placer.update(personBox, VIEWPORT, 250);
  assert.ok(third, 'update after interval should return position');
});

test('createAvatarPlacer maintains hysteresis to prevent thrashing', () => {
  const placer = createAvatarPlacer({ intervalMs: 0 });

  const screenRightPersonKp = standing(400, 1);
  const screenRightPersonBox = personBoundingBox(screenRightPersonKp, VIEWPORT);
  placer.forceUpdate(screenRightPersonBox, VIEWPORT);
  assert.equal(placer.side, 'left', 'should move left when person on screen-right');

  const centerKp = standing(960, 1);
  const centerBox = personBoundingBox(centerKp, VIEWPORT);
  placer.forceUpdate(centerBox, VIEWPORT);
  assert.equal(placer.side, 'left', 'should stay left with centered person (hysteresis)');

  const screenLeftPersonKp = standing(1500, 1);
  const screenLeftPersonBox = personBoundingBox(screenLeftPersonKp, VIEWPORT);
  placer.forceUpdate(screenLeftPersonBox, VIEWPORT);
  assert.equal(placer.side, 'right', 'should move right when person on screen-left');
});

test('createAvatarPlacer reset returns to default state', () => {
  const placer = createAvatarPlacer({ intervalMs: 0 });
  const kp = standing(400, 1);
  const personBox = personBoundingBox(kp, VIEWPORT);
  placer.forceUpdate(personBox, VIEWPORT);
  assert.equal(placer.side, 'left', 'should move left when person on screen-right');

  placer.reset();
  assert.equal(placer.side, 'right', 'should reset to right side');
  assert.equal(placer.scale, 1, 'should reset scale to 1');
});

test('fixture: synthetic bbox track - avatar never intersects person', () => {
  const placer = createAvatarPlacer({ intervalMs: 0 });

  const track = [
    { cx: 400, scale: 1 },
    { cx: 600, scale: 1 },
    { cx: 960, scale: 1 },
    { cx: 1200, scale: 1 },
    { cx: 1500, scale: 1 },
    { cx: 1500, scale: 2 },
    { cx: 960, scale: 2 },
    { cx: 400, scale: 2 },
  ];

  for (const { cx, scale } of track) {
    const kp = standing(cx, scale);
    const personBox = personBoundingBox(kp, VIEWPORT);
    if (!personBox) continue;

    const position = placer.forceUpdate(personBox, VIEWPORT);
    const personNorm = normalizePersonBox(personBox, VIEWPORT);
    const avatarRect = getAvatarRect(position);

    assert.ok(
      !rectsIntersect(personNorm, avatarRect),
      `Avatar should not intersect person at cx=${cx}, scale=${scale}. ` +
      `Person: ${JSON.stringify(personNorm)}, Avatar: ${JSON.stringify(avatarRect)}`
    );
  }
});

test('fixture: rapid movement track - avatar stays stable', () => {
  const placer = createAvatarPlacer({ intervalMs: 200 });
  let sideChanges = 0;
  let lastSide = 'right';

  const track = [
    { cx: 800, t: 0 },
    { cx: 900, t: 50 },
    { cx: 1000, t: 100 },
    { cx: 1100, t: 150 },
    { cx: 1000, t: 200 },
    { cx: 900, t: 250 },
    { cx: 1000, t: 300 },
    { cx: 1100, t: 350 },
    { cx: 1000, t: 400 },
    { cx: 900, t: 450 },
  ];

  for (const { cx, t } of track) {
    const kp = standing(cx, 1);
    const personBox = personBoundingBox(kp, VIEWPORT);
    const position = placer.update(personBox, VIEWPORT, t);

    if (position && position.side !== lastSide) {
      sideChanges++;
      lastSide = position.side;
    }
  }

  assert.ok(
    sideChanges <= 2,
    `Side should not change frequently during rapid movement. Changes: ${sideChanges}`
  );
});

test('fixture: close-up approach - avatar scales down smoothly', () => {
  const placer = createAvatarPlacer({ intervalMs: 0 });
  let lastScale = 1;
  let scaleDecreased = false;

  const track = [
    { scale: 1, frameFill: 0.1 },
    { scale: 1.5, frameFill: 0.25 },
    { scale: 2, frameFill: 0.4 },
    { scale: 2.5, frameFill: 0.55 },
    { scale: 3, frameFill: 0.7 },
  ];

  for (const { scale, frameFill } of track) {
    const kp = standing(960, scale);
    const personBox = personBoundingBox(kp, VIEWPORT);
    personBox.frameFill = frameFill;

    const position = placer.forceUpdate(personBox, VIEWPORT);

    if (position.scale < lastScale) {
      scaleDecreased = true;
    }

    assert.ok(
      Math.abs(position.scale - lastScale) <= 0.35,
      `Scale should change smoothly. Was ${lastScale}, now ${position.scale}`
    );

    lastScale = position.scale;
  }

  assert.ok(scaleDecreased, 'Avatar should scale down during close-up approach');
  assert.ok(lastScale < 1, 'Final scale should be less than 1 for large frameFill');
});
