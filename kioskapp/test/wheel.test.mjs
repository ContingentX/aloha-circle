import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWheelSvg, spinOutcome, createGrabSpinGesture, SPIN_DECEL } from '../renderer/wheel.js';
import { KP } from '../renderer/gestures.js';
import { EXPERIENCES } from '../renderer/matchData.js';

const VIDEO = { width: 640, height: 480 };

// 13-slot keypoint frame builder: nose + shoulders fixed, wrists positionable.
function frame({ leftWrist = null, rightWrist = null, noseY = 200 } = {}) {
  const kp = new Array(13).fill(null);
  kp[KP.nose] = { x: 320, y: noseY, score: 0.9 };
  kp[KP.leftShoulder] = { x: 260, y: 280, score: 0.9 };
  kp[KP.rightShoulder] = { x: 380, y: 280, score: 0.9 }; // shoulderWidth = 120
  if (leftWrist) kp[KP.leftWrist] = { score: 0.9, ...leftWrist };
  if (rightWrist) kp[KP.rightWrist] = { score: 0.9, ...rightWrist };
  return kp;
}

describe('buildWheelSvg', () => {
  test('one wedge and label per experience, plus a rotor group', () => {
    const svg = buildWheelSvg(EXPERIENCES);
    assert.ok(svg.includes('id="wheel-rotor"'));
    assert.equal((svg.match(/<path /g) || []).length, EXPERIENCES.length);
    for (const exp of EXPERIENCES) {
      assert.ok(svg.includes(`>${exp.short.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)}<`), exp.short);
    }
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
    // grab, then a shallow 60px pull: below 1.5 × shoulder width → no spin
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 180 } }), VIDEO, 500), null);
    assert.equal(g.state, 'grabbed');
  });

  test('pull window expires → back to idle (slow lower ≠ spin)', () => {
    const g = createGrabSpinGesture();
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 0);
    g.feed(frame({ rightWrist: { x: 330, y: 120 } }), VIDEO, 300);
    assert.equal(g.state, 'grabbed');
    assert.equal(g.feed(frame({ rightWrist: { x: 330, y: 360 } }), VIDEO, 1500), null);
    assert.equal(g.state, 'idle');
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
