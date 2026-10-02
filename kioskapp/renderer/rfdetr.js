// RF-DETR Keypoint client for Roboflow Inference server.
// Used when ROBOFLOW_INFER_URL is set (e.g. http://localhost:9001).
// Returns COCO-17 keypoints in the same format as MoveNet for gestures.js.

const INFERENCE_TIMEOUT_MS = 2000;

export function getRoboflowInferUrl() {
  // Sandboxed renderer: the env var crosses via the preload bridge.
  if (typeof window !== 'undefined') {
    if (window.kiosk?.roboflowInferUrl) return window.kiosk.roboflowInferUrl;
    if (window.ROBOFLOW_INFER_URL) return window.ROBOFLOW_INFER_URL;
  }
  if (typeof process !== 'undefined' && process.env?.ROBOFLOW_INFER_URL) {
    return process.env.ROBOFLOW_INFER_URL;
  }
  return null;
}

function canvasToBase64(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

function videoToBase64(video, canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvasToBase64(canvas);
}

export class RFDETRKeypointDetector {
  constructor(inferUrl) {
    this.inferUrl = inferUrl.replace(/\/$/, '');
    this.offscreenCanvas = null;
    this.modelId = 'coco-keypoints';
  }

  async estimatePoses(videoEl, _opts = {}) {
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }

    const base64 = videoToBase64(videoEl, this.offscreenCanvas);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.inferUrl}/infer/keypoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { type: 'base64', value: base64 },
          model_id: this.modelId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`RF-DETR inference failed: ${response.status}`);
      }

      const data = await response.json();
      const predictions = data.predictions || [];
      if (predictions.length === 0) {
        return [];
      }

      const person = predictions[0];
      const keypoints = this.parseKeypointsPrediction(person, videoEl);
      return [{ keypoints, score: person.confidence || 1.0 }];
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.warn('[rfdetr] inference timeout');
      } else {
        console.warn('[rfdetr] inference error:', err.message);
      }
      return [];
    }
  }

  parseKeypointsPrediction(prediction, videoEl) {
    const keypointsData = prediction.keypoints || [];
    const vw = videoEl.videoWidth || 640;
    const vh = videoEl.videoHeight || 480;
    const bx = prediction.x || 0;
    const by = prediction.y || 0;
    const bw = prediction.width || vw;
    const bh = prediction.height || vh;

    const result = [];
    for (let i = 0; i < keypointsData.length; i++) {
      const kp = keypointsData[i];
      if (!kp || kp.visibility === 0) {
        result.push({ x: 0, y: 0, score: 0, name: this.keypointName(i) });
        continue;
      }

      let x, y;
      if (typeof kp.x === 'number' && typeof kp.y === 'number') {
        x = kp.x;
        y = kp.y;
      } else if (Array.isArray(kp) && kp.length >= 2) {
        x = bx - bw / 2 + kp[0] * bw;
        y = by - bh / 2 + kp[1] * bh;
      } else {
        result.push({ x: 0, y: 0, score: 0, name: this.keypointName(i) });
        continue;
      }

      const score = kp.confidence ?? kp.visibility ?? kp[2] ?? 0.9;
      result.push({
        x,
        y,
        score,
        name: this.keypointName(i),
      });
    }

    return result;
  }

  keypointName(index) {
    const names = [
      'nose',
      'left_eye',
      'right_eye',
      'left_ear',
      'right_ear',
      'left_shoulder',
      'right_shoulder',
      'left_elbow',
      'right_elbow',
      'left_wrist',
      'right_wrist',
      'left_hip',
      'right_hip',
      'left_knee',
      'right_knee',
      'left_ankle',
      'right_ankle',
    ];
    return names[index] || `keypoint_${index}`;
  }

  dispose() {
    this.offscreenCanvas = null;
  }
}

export async function createRFDETRDetector(inferUrl) {
  const detector = new RFDETRKeypointDetector(inferUrl);
  const testUrl = `${detector.inferUrl}/health`;
  try {
    const response = await fetch(testUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  } catch (err) {
    throw new Error(`RF-DETR server unreachable at ${inferUrl}: ${err.message}`);
  }
  return detector;
}
