// Pose & gesture detection — stubbed for the MVP (stages advance by button).
//
// Plan (NVIDIA team's suggestion: https://roboflow.com/blog/best-pose-estimation-models):
// RF-DETR Keypoint via a local Roboflow Inference server on the kiosk GPU
// (`docker run roboflow/inference-server-gpu`), posting downscaled frames from
// the <video> element at ~10 fps and mapping COCO-17 keypoints to the ritual's
// gesture events:
//
//   gaze_at_screen   — face present + both eyes visible + head yaw ~0 for 1s
//                      (nose x centered between eyes; face bbox above min size)
//   forehead_touch   — face bbox grows past a near-field threshold (visitor
//                      leans into the padded forehead rest on the bezel) and
//                      holds for 5s; the hold timer in app.js becomes the
//                      detector's dwell window
//   hands_over_eyes  — both wrist keypoints within radius r of the eye keypoints
//   hands_over_ears  — both wrists within r of the ear keypoints
//   hand_near_nose   — either wrist within r of the nose keypoint
//   hands_on_heart   — both wrists inside the upper-chest box (between
//                      shoulders, below shoulder line, above hip line)
//
// Each predicate must hold for ~15 consecutive frames (1.5s dwell) before the
// event fires, so a wave past the face doesn't advance a stage. Radii scale
// with the shoulder-to-shoulder pixel distance so near and far visitors work.
//
// Fallback when no GPU/inference server is present: MoveNet (TF.js, WebGL)
// in-renderer — same keypoint schema, lower accuracy, zero install.
//
// The avatar-dodge feature (Kanaloa slides aside as the visitor moves) uses
// the face bbox center: when it overlaps the avatar card's screen rect, flip
// the card to the opposite side (the CSS transition on #avatar-card already
// animates it).

export function createPoseDetector() {
  return {
    start(_videoEl, _onEvent) {
      console.log('[pose] detector stubbed — stages advance via buttons');
    },
    stop() {},
  };
}
