# Aloha Circle kiosk app

Electron app for the screens at the Aloha Circle in Maui. It runs **The Breath
of Aloha** — a guided sensory ritual led by **Kanaloa**, a Hawaiian girl avatar
made of ocean water (rendered with [Masky](https://masky.ai)), over a live
camera view of the visitor.

## Ritual flow

1. **Attract / Begin** — camera preview, big Begin button.
2. **Welcome** — Kanaloa introduces herself ("Aloha from my heart to your
   heart, stranger, my name is Kanaloa") and explains the experience.
3. **Honi Ihu** — forehead-to-forehead greeting of breath: hold for 5 seconds
   (breath ring countdown). MVP simulates the touch with a button; pose
   detection will trigger it (see `renderer/pose.js`).
4. **The Eyes** 👁️ — bless your eyes to see beauty and compassion.
5. **The Ears** 👂 — intend to listen, tune into inner wisdom.
6. **The Nose** 👃 — the hā, breath of life: inhale goodness, release the rest.
7. **The Heart** ❤️ — hands stacked on chest: "from my heart to your heart."
8. **Mahalo** — closing blessing, start over.

Every stage shows Kanaloa's pre-rendered speak clip in a floating card over the
camera feed; visitors hear her through the provided headphones.

## Run it

```bash
cd kioskapp
npm install
npm run fetch-media   # pulls Kanaloa's clips from aloha-circle.com/media/kiosk
npm start             # windowed dev mode
npm run kiosk         # fullscreen kiosk mode
```

Without `fetch-media` the app still works — clips stream from the media bucket.

## Optional reasoning (CoreWeave)

`src/reasoning.cjs` calls W&B Inference on CoreWeave for in-experience
reasoning (personalized blessings, adaptive coaching). Export the key first —
it lives in SSM at `/alohaintelligence/production/coreweave_api_key` and is
never committed:

```bash
export COREWEAVE_API_KEY=$(aws ssm get-parameter \
  --name /alohaintelligence/production/coreweave_api_key \
  --with-decryption --query Parameter.Value --output text)
```

Without the key the kiosk uses canned fallback lines.

## Session recordings (VAST / team-18 VSS)

Each completed ritual (visitor reached Mahalo) is recorded from the camera and
saved to `recordings/` as `aloha-<stamp>-<sessionId>.webm` plus a `.json`
sidecar (stage timeline). Abandoned sessions are discarded.

With the team-18 VAST credentials exported, recordings also upload to the VAST
object store and trigger a VSS batch-sync so they appear at
<https://team-18-vss.thecosmoslabs.com/search>:

```bash
export VAST_S3_ENDPOINT=…   # S3-compatible endpoint from the lab VM
export VAST_S3_BUCKET=…
export VAST_S3_ACCESS_KEY=…
export VAST_S3_SECRET_KEY=…
# optional: VAST_S3_REGION (default us-east-1), VAST_S3_PREFIX (default aloha-sessions/)

export VSS_URL=https://team-18-vss.thecosmoslabs.com
export VSS_USERNAME=…       # VSS blueprint login
export VSS_PASSWORD=…
```

Without the env vars the kiosk keeps local copies only — nothing is lost, and
the upload path (`src/vastUpload.cjs`, dependency-free SigV4) is unit-tested.

## Pose detection

Live in `renderer/pose.js` (MoveNet Lightning via TF.js) with deterministic
predicates in `renderer/gestures.js`. Stages auto-advance after a 1.5s dwell;
Next/Skip still work if the model misses. Gaze on the attract screen starts the
welcome; leaning into the camera starts the 5s honi hold; Kanaloa's card slides
aside when your face overlaps it.

Optional **Cosmos 3 Reasoner NIM** (`COSMOS_NIM_URL`) is a second-opinion VLM
if a gesture stage stalls ~8s — it is not the live detector. See `PLAN.md`.

## Post-Mahalo recap reel (Cosmos Generator NIM)

After Mahalo, the kiosk generates a short stylized recap clip of the visitor's
ritual journey. This runs asynchronously — the next visitor can start
immediately. Output is saved alongside the session recording so the existing
VAST uploader ships it to the gallery.

### Configuration

```bash
export COSMOS_GEN_URL=http://localhost:8000/v1/generate   # or NIM endpoint
# Optional:
export COSMOS_GEN_MODE=openai      # 'openai' (default) or 'nim'
export COSMOS_GEN_MODEL=nvidia/cosmos-generator-i2v
export COSMOS_API_KEY=...          # or NVIDIA_API_KEY
```

### Endpoint modes

**OpenAI-compatible (default):** POST JSON to `COSMOS_GEN_URL`

```json
{
  "model": "nvidia/cosmos-generator-i2v",
  "prompt": "Create a gentle, warm highlight reel...",
  "images": ["data:image/jpeg;base64,..."],
  "duration_seconds": 14,
  "fps": 24
}
```

Response: `{ "video": "data:video/mp4;base64,..." }` or
`{ "data": [{ "b64_video": "..." }] }`

**NIM-native (`COSMOS_GEN_MODE=nim`):** POST multipart/form-data with
`images[]`, `prompt`, `num_frames`, `fps`. Response: binary MP4 or
`{ "video_base64": "..." }`.

### Fallback

Without `COSMOS_GEN_URL` or on API error, the kiosk falls back to a plain
ffmpeg-concatenated highlight (one ~2s slice per stage) — there's always a
shareable artifact. Requires `ffmpeg` in PATH.

```bash
cd kioskapp && npm test   # gesture predicates + cosmos no-op hook + recap tests
```

## Regenerating Kanaloa's clips

The avatar (`Kanaloa`, Masky avatar `hPozOmvYl2TGkeDxAORy`) and her clips were
produced with the Masky public API (`POST /avatars`, then one `speak`-mode
conversation turn per stage, `output: "video"`). Each script is ≤3 sentences so
one turn renders one clip. Rendered MP4s are uploaded to the site media buckets
under `media/kiosk/<stage>.mp4`.
