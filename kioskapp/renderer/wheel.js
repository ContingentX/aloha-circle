// The Wheel of Aloha — prize wheel of sponsor experiences, spun with an AR
// grab-and-pull gesture: reach up, hold the top of the wheel, pull down.
//
// Pure logic (no DOM except the SVG string builder): spin physics and the
// gesture state machine are fixture-tested from Node like gestures.js.

import { KP, MIN_SCORE, WRIST_MIN_SCORE, shoulderWidth } from './gestures.js';

export const SPIN_DECEL = 120; // deg/s² — a 720 deg/s pull coasts for 6s

const PALETTE = [
  '#0b6e8c', '#37c3b8', '#f4a259', '#e76f51',
  '#2a9d8f', '#e9c46a', '#8ab17d', '#c85c8e',
];

function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180; // 0° = top, clockwise
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Inner markup for a 400×400 viewBox SVG: a rotor group (#wheel-rotor) whose
// CSS `transform: rotate()` app.js animates, plus a hub. Pointer lives in HTML.
export function buildWheelSvg(experiences) {
  const n = experiences.length;
  const seg = 360 / n;
  const cx = 200, cy = 200, r = 192;
  const wedges = experiences.map((exp, i) => {
    const a0 = i * seg;
    const a1 = a0 + seg;
    const p0 = polar(cx, cy, r, a0);
    const p1 = polar(cx, cy, r, a1);
    const large = seg > 180 ? 1 : 0;
    const mid = polar(cx, cy, r * 0.62, a0 + seg / 2);
    const rot = a0 + seg / 2;
    return (
      `<path d="M${cx},${cy} L${p0.x.toFixed(1)},${p0.y.toFixed(1)} ` +
      `A${r},${r} 0 ${large} 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)} Z" ` +
      `fill="${PALETTE[i % PALETTE.length]}" stroke="rgba(4,36,58,0.6)" stroke-width="2"/>` +
      `<text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" ` +
      `transform="rotate(${rot.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)})" ` +
      `text-anchor="middle" dominant-baseline="middle" class="wheel-label">${esc(exp.short)}</text>`
    );
  }).join('');
  return (
    `<g id="wheel-rotor">${wedges}</g>` +
    `<circle cx="${cx}" cy="${cy}" r="26" fill="#04243a" stroke="#e9fbff" stroke-width="3"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="wheel-hub">\u{1F33A}</text>`
  );
}

// Deterministic physics: constant deceleration from an initial velocity.
// Returns the total travel, the animation duration, and which segment ends up
// under the top pointer. `startAngle` is the rotor's current (un-modded)
// rotation so consecutive spins keep turning forward.
export function spinOutcome(velocity, { segments, decel = SPIN_DECEL, startAngle = 0 }) {
  const v0 = Math.max(0, Number(velocity) || 0);
  const travel = (v0 * v0) / (2 * decel);
  const finalAngle = startAngle + travel;
  const durationMs = Math.round((v0 / decel) * 1000);
  const seg = 360 / segments;
  // Rotor rotated clockwise by finalAngle → the wheel-local angle at the top
  // pointer is the rotation's complement.
  const local = (360 - (((finalAngle % 360) + 360) % 360)) % 360;
  // Epsilon guards float drift at wedge boundaries (e.g. a travel of exactly 90°).
  const index = Math.floor((local + 1e-7) / seg) % segments;
  return { travel, finalAngle, durationMs, index };
}

// Gesture: a wrist raised above the face (reaching for the wheel's top), held
// briefly = grab; then a fast pull down of at least ~1.5 shoulder-widths
// within the pull window = spin, with velocity set by pull speed.
// feed(kp13, video, t) returns null | {type:'grab'} | {type:'spin', velocity}.
export function createGrabSpinGesture(opts = {}) {
  const grabHoldMs = opts.grabHoldMs ?? 250;
  const graceMs = opts.graceMs ?? 300;
  const maxPullMs = opts.maxPullMs ?? 900;
  const pullScale = opts.pullScale ?? 1.5;
  const minVelocity = opts.minVelocity ?? 360;
  const maxVelocity = opts.maxVelocity ?? 1440;
  const velocityScale = opts.velocityScale ?? 700;

  let state = 'idle';
  let side = null; // KP index of the grabbed wrist
  let raisedSince = 0;
  let lastRaised = 0;
  let grabY = 0;
  let grabT = 0;
  let scale = 0;

  const wrist = (kp, idx) => {
    const k = kp[idx];
    return k && k.score >= WRIST_MIN_SCORE && Number.isFinite(k.y) ? k : null;
  };

  const reset = () => {
    state = 'idle';
    side = null;
  };

  return {
    get state() {
      return state;
    },
    reset,
    feed(kp, video, t = Date.now()) {
      if (!Array.isArray(kp)) return null;

      if (state === 'idle' || state === 'raised') {
        const nose = kp[KP.nose] && kp[KP.nose].score >= MIN_SCORE ? kp[KP.nose] : null;
        const raised = nose
          ? [KP.leftWrist, KP.rightWrist]
              .map((i) => ({ i, k: wrist(kp, i) }))
              .filter((c) => c.k && c.k.y < nose.y)
          : [];
        if (!raised.length) {
          // MoveNet flickers — give the raise a grace window before resetting.
          if (state === 'raised' && t - lastRaised > graceMs) reset();
          return null;
        }
        lastRaised = t;
        if (state === 'idle') {
          state = 'raised';
          raisedSince = t;
          return null;
        }
        if (t - raisedSince >= grabHoldMs) {
          state = 'grabbed';
          side = raised[0].i;
          grabY = raised[0].k.y;
          grabT = t;
          scale = shoulderWidth(kp) || (video?.height || 480) * 0.15;
          return { type: 'grab' };
        }
        return null;
      }

      if (state === 'grabbed') {
        if (t - grabT > maxPullMs) {
          reset();
          return null;
        }
        const k = wrist(kp, side);
        if (!k) return null; // flicker — the pull window is the real deadline
        const drop = k.y - grabY;
        if (drop < scale * pullScale) return null;
        const dtSec = Math.max((t - grabT) / 1000, 0.05);
        const heightsPerSec = drop / Math.max(video?.height || 480, 1) / dtSec;
        const velocity = Math.min(maxVelocity, Math.max(minVelocity, heightsPerSec * velocityScale));
        reset();
        return { type: 'spin', velocity };
      }

      return null;
    },
  };
}
