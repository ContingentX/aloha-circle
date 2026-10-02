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

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180; // 0° = top, clockwise
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Inner markup for a 400×400 viewBox SVG: a rotor group (#wheel-rotor) whose
// CSS `transform: rotate()` app.js animates, plus a hub. Pointer lives in HTML.
// Wedges carry big numbers (1…n), not titles — the landed number is mapped to
// its experience in the result banner, so labels stay readable while spinning.
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
      `text-anchor="middle" dominant-baseline="middle" class="wheel-number">${i + 1}</text>`
    );
  }).join('');
  // transform-origin inline on the rotor: CSS rotate() on an SVG group pivots
  // on the viewBox's 0,0 unless transform-box re-anchors it to the center —
  // without this the wheel orbits an off-screen axis instead of spinning.
  return (
    `<g id="wheel-rotor" style="transform-box:view-box;transform-origin:50% 50%">${wedges}</g>` +
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
// briefly = grab; then a fast pull down of at least ~0.8 shoulder-widths = spin,
// with velocity set by pull speed. The pull clock starts when the hand actually
// starts moving (the anchor re-baselines while it hovers at the top), not when
// the grab fired — reaction time doesn't eat the window. If MoveNet loses the
// wrist mid-pull (its usual failure during fast motion), the same-side elbow's
// drop stands in for it.
// feed(kp13, video, t) returns null | {type:'grab'} | {type:'spin', velocity}.
export function createGrabSpinGesture(opts = {}) {
  const grabHoldMs = opts.grabHoldMs ?? 250;
  const graceMs = opts.graceMs ?? 300;
  const maxGrabMs = opts.maxGrabMs ?? 5000; // how long a grab may hover before re-arming
  const maxPullMs = opts.maxPullMs ?? 1200; // window for the pull itself, from its first movement
  const pullScale = opts.pullScale ?? 0.8;
  const settleScale = opts.settleScale ?? 0.25; // drift below this keeps re-baselining the anchor
  const minPullSpeed = opts.minPullSpeed ?? 0.5; // video-heights/s — slower is lowering, not pulling
  const elbowTravel = opts.elbowTravel ?? 1.6; // the elbow arcs ~60% of the wrist's pull distance
  const minVelocity = opts.minVelocity ?? 360;
  const maxVelocity = opts.maxVelocity ?? 1440;
  const velocityScale = opts.velocityScale ?? 700;

  let state = 'idle';
  let side = null; // KP index of the grabbed wrist
  let raisedSince = 0;
  let lastRaised = 0;
  let grabT = 0; // when the grab fired
  let baseY = 0; // pull anchor: the wrist's y while parked at the top
  let baseT = 0; // when the anchor last moved = when the pull started
  let elbowBaseY = null;
  let scale = 0;

  const wrist = (kp, idx) => {
    const k = kp[idx];
    return k && k.score >= WRIST_MIN_SCORE && Number.isFinite(k.y) ? k : null;
  };
  const elbow = (kp) => {
    const k = kp[side === KP.leftWrist ? KP.leftElbow : KP.rightElbow];
    return k && k.score >= MIN_SCORE && Number.isFinite(k.y) ? k : null;
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
          grabT = t;
          baseY = raised[0].k.y;
          baseT = t;
          const e = elbow(kp);
          elbowBaseY = e ? e.y : null;
          scale = shoulderWidth(kp) || (video?.height || 480) * 0.15;
          return { type: 'grab' };
        }
        return null;
      }

      if (state === 'grabbed') {
        if (t - grabT > maxGrabMs) {
          reset();
          return null;
        }
        const w = wrist(kp, side);
        const e = elbow(kp);
        let drop = null;
        if (w) drop = w.y - baseY;
        else if (e && elbowBaseY != null) drop = (e.y - elbowBaseY) * elbowTravel;
        if (drop == null) return null; // both joints flickered out this frame
        if (drop < scale * settleScale) {
          // Hand still parked at the top (or drifting) — follow it so the pull
          // clock and distance start from where the pull actually begins.
          if (w) baseY = w.y;
          if (e) elbowBaseY = e.y;
          baseT = t;
          return null;
        }
        if (t - baseT > maxPullMs) {
          reset();
          return null;
        }
        if (drop < scale * pullScale) return null;
        const dtSec = Math.max((t - baseT) / 1000, 0.05);
        const heightsPerSec = drop / Math.max(video?.height || 480, 1) / dtSec;
        if (heightsPerSec < minPullSpeed) {
          reset(); // covered the distance but too slowly — a lower, not a pull
          return null;
        }
        const velocity = Math.min(maxVelocity, Math.max(minVelocity, heightsPerSec * velocityScale));
        reset();
        return { type: 'spin', velocity };
      }

      return null;
    },
  };
}
