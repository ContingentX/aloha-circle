import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWheelSvg, spinOutcome, createGrabSpinGesture, SPIN_DECEL } from '../renderer/wheel.js';
import { KP } from '../renderer/gestures.js';
import { EXPERIENCES } from '../renderer/matchData.js';

const VIDEO = { width: 640, height: 480 };

// 13-slot keypoint frame builder: nose + shoulders fixed, wrists/elbows positionable.
function frame({ leftWrist = null, rightWrist = null, rightElbow = null, noseY = 200 } = {}) {
  const kp = new Array(13).fill(null);
  kp[KP.nose] = { x: 320, y: noseY, score: 0.9 };
  kp[KP.leftShoulder] = { x: 260, y: 280, score: 0.9 };
  kp[KP.rightShoulder] = { x: 380, y: 280, score: 0.9 }; // shoulderWidth = 120
  if (leftWrist) kp[KP.leftWrist] = { score: 0.9, ...leftWrist };
  if (rightWrist) kp[KP.rightWrist] = { score: 0.9, ...rightWrist };
  if (rightElbow) kp[KP.rightElbow] = { score: 0.9, ...rightElbow };
  return kp;
}

describe('buildWheelSvg', () => {
  test('one wedge and number label per experience, plus a rotor group', () => {
    const svg = buildWheelSvg(EXPERIENCES);
    assert.ok(svg.includes('id="wheel-rotor"'));
    assert.equal((svg.match(/<path /g) || []).length, EXPERIENCES.length);
    for (let i = 1; i <= EXPERIENCES.length; i++) {
      assert.ok(svg.includes(`class="wheel-number">${i}<`), `number ${i}`);
    }
  });

  test('rotor pivots on the wheel center, not the viewBox corner', () => {
    // CSS rotate() on an SVG group spins around viewBox 0,0 unless the rotor
    // re-anchors with transform-box — this is the off-screen-axis bug guard.
    const svg = buildWheelSvg(EXPERIENCES);
    const rotor = svg.match(/<g id="wheel-rotor"[^>]*>/)[0];
    assert.ok(rotor.includes('transform-box:view-box'), rotor);
    assert.ok(rotor.includes('transform-origin:50% 50%'), rotor);
  });
});

describe('spinOutcome', () => {
  test('constant deceleration physics: travel and duration from velocity', () => {
    const out = spinOutcome(720, { segments: 8, decel: 120 });
    assert.equal(out.travel, 2160); // 720² / (2·120)
    assert.equal(out.durationMs, 6000); // 720 / 120
    assert.equal(out.finalAngle, 2160);
  });

  test('pointer lands on the complement segment of the final rotation', () => {
    // travel 2160 ≡ 0 (mod 360) → pointer sits on segment 0
    assert.equal(spinOutcome(720, { segments: 8, decel: 120 }).index, 0);
    // finalAngle 90° → wheel-local angle at the top pointer is 270° → wedge 6 of 8
    const v = Math.sqrt(2 * 120 * 90); // travel = 90
    assert.equal(spinOutcome(v, { segments: 8, decel: 120 }).index, 6);
  });

  test('startAngle accumulates so consecutive spins keep turning forward', () => {
    const first = spinOutcome(720, { segments: 8, decel: 120 });
    const second = spinOutcome(720, { segments: 8, decel: 120, startAngle: first.finalAngle });
    assert.ok(second.finalAngle > first.finalAngle);
  });

  test('default deceleration is exported and sane', () => {
    assert.ok(SPIN_DECEL > 0);
    const out = spinOutcome(720, { segments: EXPERIENCES.length });
    assert.ok(out.index >= 0 && out.index < EXPERIENCES.length);
  });
});

describe('createGrabSpinGesture', () => {
  test('raise above the face, hold, pull down fast → grab then spin', () => {
    const g = createGrabSpinGesture();
    // Wrist raised above nose (y < noseY)
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0), null);
    assert.equal(g.state, 'raised');
    const grab = g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.deepEqual(grab, { type: 'grab' });
    assert.equal(g.state, 'grabbed');
    // Fast pull: 240px drop (> 1.5 × shoulderWidth 120) in 400ms
    const spin = g.feed(frame({ rightWrist: { x: 330, y: 360 } }), VIDEO, 700);
    assert.equal(spin.type, 'spin');
    assert.ok(spin.velocity >= 360 && spin.velocity <= 1440, `velocity ${spin.velocity}`);
    assert.equal(g.state, 'idle');
  });

  test('a faster pull spins harder (until the cap)', () => {
    const run = (pullMs) => {
      const g = createGrabSpinGesture();
      g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
      g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
      return g.feed(frame({ rightWrist: { x: 330, y: 360 } }), VIDEO, 300 + pullMs);
    };
    const fast = run(200);
    const slow = run(850);
    assert.ok(fast.velocity > slow.velocity);
  });

  test('no grab without the hold; no spin without the pull distance', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    // only 100ms raised — not yet grabbed
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 100), null);
    assert.equal(g.state, 'raised');
    // grab, then a shallow 60px pull: below 0.8 × shoulder width → no spin
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 180 } }), VIDEO, 500), null);
    assert.equal(g.state, 'grabbed');
  });

  test('a slow lower covers the distance but is not a pull → back to idle', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.equal(g.state, 'grabbed');
    // 240px over 1.2s ≈ 0.42 heights/s — under the 0.5 pull-speed floor
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 360 } }), VIDEO, 1500), null);
    assert.equal(g.state, 'idle');
  });

  test('pull window expires once the hand starts moving and stalls', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 600); // parked — anchor refreshes
    // moved 50px (past the settle band) but 1.4s after the anchor → expired
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 170 } }), VIDEO, 2000), null);
    assert.equal(g.state, 'idle');
  });

  test('hovering at the top does not burn the pull window (re-baseline)', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    assert.deepEqual(g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300), { type: 'grab' });
    // Visitor reads the "pull down" hint for 1.2s before moving — the old code
    // timed out here because its window started at the grab itself.
    for (const t of [600, 900, 1200, 1500]) {
      assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 121 } }), VIDEO, t), null);
      assert.equal(g.state, 'grabbed');
    }
    const spin = g.feed(frame({ rightWrist: { x: 330, y: 361 } }), VIDEO, 1800);
    assert.equal(spin.type, 'spin');
  });

  test('wrist lost mid-pull → the elbow drop carries the spin', () => {
    const g = createGrabSpinGesture();
    const atTop = frame({ rightWrist: { x: 330, y: 120 }, rightElbow: { x: 350, y: 200 } });
    g.feed(atTop, VIDEO, 0);
    assert.deepEqual(g.feed(atTop, VIDEO, 300), { type: 'grab' });
    // MoveNet drops the fast-moving wrist; elbow fell 120px ≈ 192px of wrist travel
    const spin = g.feed(frame({ rightElbow: { x: 350, y: 320 } }), VIDEO, 650);
    assert.equal(spin.type, 'spin');
    assert.ok(spin.velocity >= 360, `velocity ${spin.velocity}`);
  });

  test('a grab left hovering eventually re-arms', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    for (let t = 600; t <= 5100; t += 500) {
      g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, t);
    }
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 5400), null);
    assert.equal(g.state, 'idle'); // re-armed: the next raised hold can grab again
  });

  test('one flickered frame does not drop the raise', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    g.feed(frame(), VIDEO, 100); // wrist lost for a frame
    assert.equal(g.state, 'raised');
    const grab = g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.deepEqual(grab, { type: 'grab' });
  });

  test('wrist below the face never arms', () => {
    const g = createGrabSpinGesture();
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 400 } }), VIDEO, 0), null);
    assert.equal(g.state, 'idle');
  });
});
