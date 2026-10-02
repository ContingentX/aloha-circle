// Live pose loop for the kiosk.
//
// Primary (hackathon, zero-install): MoveNet Lightning via TF.js in the renderer.
// GPU path: post frames to a local Roboflow Inference server (RF-DETR Keypoint)
// when ROBOFLOW_INFER_URL is set — same COCO-17 keypoints, same predicates in
// gestures.js. Example: ROBOFLOW_INFER_URL=http://localhost:9001
//
// Cosmos 3 is NOT the live detector. It is an optional VLM judge (see cosmos.cjs)
// that app.js may call if a gesture stage stalls.

import {
  classifyGesture,
  createDwellTracker,
} from './gestures.js';
import { createRFDETRDetector, getRoboflowInferUrl } from './rfdetr.js';

const FPS_MS = 100;
const DWELL_FRAMES = 15; // 1.5s at 10 fps

function videoSize(video) {
  return {
    width: video.videoWidth || video.clientWidth || 640,
    height: video.videoHeight || video.clientHeight || 480,
  };
}

function coverMap(video, canvas) {
  const vw = video.videoWidth || canvas.width;
  const vh = video.videoHeight || canvas.height;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  return {
    mapX: (x) => x * scale + (canvas.width - vw * scale) / 2,
    mapY: (y) => y * scale + (canvas.height - vh * scale) / 2,
  };
}

function drawOverlay(canvas, video, classified, dwell, expected) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const { mapX, mapY } = coverMap(video, canvas);

  ctx.save();
  // Camera CSS is mirrored; match it so dots sit on the visitor's joints.
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  if (classified.face) {
    const f = classified.face;
    ctx.strokeStyle = 'rgba(55, 195, 184, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(mapX(f.x), mapY(f.y), mapX(f.x + f.w) - mapX(f.x), mapY(f.y + f.h) - mapY(f.y));
  }

  for (const p of classified.keypoints) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(mapX(p.x), mapY(p.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.95)';
    ctx.fill();
  }

  ctx.restore();

  const label = classified.event
    ? `${classified.event}  ${(dwell.progress(classified.event) * 100) | 0}%`
    : expected
      ? `waiting: ${expected}`
      : 'no pose';
  ctx.fillStyle = 'rgba(4, 36, 58, 0.65)';
  ctx.fillRect(12, 12, Math.min(w - 24, 420), 40);
  ctx.fillStyle = '#e9fbff';
  ctx.font = '16px Segoe UI, system-ui, sans-serif';
  ctx.fillText(label, 24, 38);
}

async function createMoveNetDetector() {
  const poseDetection = globalThis.poseDetection;
  const tf = globalThis.tf;
  if (!poseDetection || !tf) {
    throw new Error('MoveNet scripts did not load (offline?)');
  }
  await tf.setBackend('webgl');
  await tf.ready();
  return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
  });
}

async function createDetector() {
  const inferUrl = getRoboflowInferUrl();
  if (inferUrl) {
    try {
      const detector = await createRFDETRDetector(inferUrl);
      return { detector, backend: 'RF-DETR' };
    } catch (err) {
      console.warn('[pose] RF-DETR unavailable, falling back to MoveNet:', err.message);
    }
  }
  const detector = await createMoveNetDetector();
  return { detector, backend: 'MoveNet' };
}

export function createPoseDetector() {
  let raf = 0;
  let stopped = false;
  let detector = null;
  let expected = null;
  const dwell = createDwellTracker({ frames: DWELL_FRAMES });

  return {
    setExpected(eventName) {
      if (expected !== eventName) dwell.reset();
      expected = eventName || null;
    },
    async start(videoEl, onEvent, opts = {}) {
      stopped = false;
      const canvas = opts.overlay || document.getElementById('pose-overlay');
      const status = opts.status || document.getElementById('pose-status');
      const setStatus = (text) => {
        if (status) status.textContent = text;
      };

      try {
        const result = await createDetector();
        detector = result.detector;
        setStatus(`pose: ${result.backend} live`);
      } catch (err) {
        console.warn('[pose] detector unavailable — buttons still work:', err.message);
        setStatus('pose: stub (buttons)');
        return;
      }

      const tick = async (ts) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (!tick.last) tick.last = ts;
        if (ts - tick.last < FPS_MS) return;
        tick.last = ts;
        if (!videoEl.videoWidth) return;

        let poses = [];
        try {
          poses = await detector.estimatePoses(videoEl, { maxPoses: 1, flipHorizontal: false });
        } catch (err) {
          console.warn('[pose] estimate failed', err);
          return;
        }

        const raw = poses[0]?.keypoints || [];
        const video = videoSize(videoEl);
        const classified = classifyGesture(raw, video);
        if (canvas) {
          if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
          if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;
          drawOverlay(canvas, videoEl, classified, dwell, expected);
        }

        if ((classified.face || classified.person) && typeof onEvent === 'function') {
          onEvent({ type: 'pose', face: classified.face, person: classified.person, video });
        }

        const watching = expected && classified.event === expected ? classified.event : null;
        // Still accumulate dwell only for the expected ritual event so a random
        // heart-touch cannot skip the eyes blessing.
        const fired = dwell.tick(watching);
        if (fired && typeof onEvent === 'function') {
          onEvent({ type: 'gesture', event: fired });
        }
      };

      raf = requestAnimationFrame(tick);
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (detector && typeof detector.dispose === 'function') detector.dispose();
      detector = null;
    },
  };
}
