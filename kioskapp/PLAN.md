# Aloha Circle kiosk — hackathon plan (VAST SF, 2026-10-02)

The kiosk turns the Aloha Circle in Maui into a guided **Breath of Aloha**
experience: a camera-facing screen, headphones, and Kanaloa — a water-spirit
Hawaiian girl avatar — leading each visitor through the honi ihu greeting and
the eyes/ears/nose/heart blessing sequence, verifying each gesture with pose
estimation and reacting in real time.

## Architecture

```
┌────────────────────────── kiosk (Electron, this app) ──────────────────────────┐
│  camera ──► MoveNet Lightning (TF.js, ~10 fps) ──► COCO-17 keypoints           │
│                 │ optional GPU upgrade: Roboflow RF-DETR Keypoint container    │
│                 ▼                                                              │
│            gestures.js predicates + 1.5s dwell                                 │
│                 │                                                              │
│  stage machine ◄── gesture events (gaze / honi / eyes / ears / nose / heart)   │
│       │         ▲                                                              │
│       │         └── stall (~8s) ──► Cosmos 3 Reasoner NIM (VLM YES/NO judge)   │
│       ├─► Kanaloa speak clips (Masky)  ─► avatar card + 🎧                     │
│       └─► CoreWeave (W&B Inference) ─► personalized lines / adaptive coaching  │
└────────────────────────────────────────────────────────────────────────────────┘
```

Live stage advances are **keypoints**, not a world model. Cosmos 3 and Cursor
Cloud Agents sit on either side of that loop (see below) — they do not replace
it.

## Sponsor / tool integration map

| Piece | Tool | Status | Notes |
|---|---|---|---|
| Pose estimation (live) | **MoveNet Lightning** (TF.js WebGL) | ✅ | Zero-install in the renderer; same COCO-17 schema as RF-DETR. Overlay + `pose: MoveNet live` pill. Buttons remain a fallback if CDN/WebGL fails. |
| Pose estimation (GPU) | **Roboflow RF-DETR Keypoint** (NVIDIA booth rec) | planned | Swap the estimator, keep `gestures.js`. Local `roboflow/inference` container. |
| Gesture → stage logic | `renderer/gestures.js` | ✅ | Deterministic predicates + 1.5s dwell. Eyes/ears/nose/heart/honi/gaze. Unit-tested. |
| Avatar dodge | face bbox vs card | ✅ | Kanaloa slides to the left when the visitor's mirrored face overlaps the right-side card. |
| Gaze-triggered welcome | `gaze_at_screen` on attract | ✅ | Looking at the screen auto-presses Begin. |
| Avatar + voice | **Masky** (`hPozOmvYl2TGkeDxAORy`) | ✅ | 7 pre-rendered lip-synced speak clips. |
| In-experience text reasoning | **CoreWeave / W&B Inference** | ✅ hook | Llama 3.1 8B — blessings/coaching. Key in SSM; never in git. |
| Gesture second opinion | **NVIDIA Cosmos 3 Reasoner NIM** | ✅ hook | Not realtime. If a stage stalls 8s, send one JPEG: "are they covering their eyes? YES/NO". Needs `COSMOS_NIM_URL` (Nano on RTX PRO 6000 / NIM). |
| Recap reel | **Cosmos 3 Generator NIM** | planned | Post-Mahalo Image2Video of the visitor — world generation, not detection. |
| Cursor Cloud Agents | Cursor `/cloud` | process | Coding workers that open PRs. They cannot see the kiosk camera. Use them to parallelize *code* (RF-DETR client, recap reel, QA), not runtime orchestration. |

## What Cosmos 3 is (and is not)

[Cosmos 3](https://huggingface.co/collections/nvidia/cosmos3) is NVIDIA's
omnimodal **world foundation model** (reason + generate video/action). Nano is
16B (workstation / RTX PRO 6000); Super is 64B (Hopper/Blackwell).

It is a good fit for:

1. **VLM judge** — `nvidia/cosmos3-nano-reasoner` via NIM
   (`POST /v1/chat/completions`, `image_url` data URI). Hook: `src/cosmos.cjs`.
2. **Recap / world gen** — Generator NIM `/v1/infer` Image2Video after Mahalo.

It is a **bad** fit as the 10 fps ritual detector: too heavy, wrong output
modality (video/action tokens, not COCO-17 keypoints). NVIDIA's own pose rec
for this kiosk remains RF-DETR / MoveNet.

## Cursor Cloud Agents vs this session

Cursor Cloud Agents clone the repo on a VM and hand back a PR. They offer
durable, parallel *implementation* — not an in-kiosk world model. This Grok
session is already the Cursor agent building the kiosk. Extra `/cloud` tasks
from Seth's laptop (if wanted):

- Roboflow Inference client behind a `ROBOFLOW_INFER_URL` flag
- Mahalo recap clip via Cosmos Generator NIM
- Agent-driven QA walkthrough of the stage machine

## Demo script (90 s)

1. Walk up → attract screen over live camera; look at the screen (or Begin).
2. Kanaloa welcome clip in headphones.
3. Honi ihu: lean forehead to the rest; 5-second breath ring (or the button).
4. Eyes → ears → nose → heart, each gesture dwelling 1.5s to advance.
5. Mahalo closing + personalized CoreWeave blessing.

## MVP milestones

- [x] `/kioskapp` Electron shell: fullscreen camera, stage machine, Next/Skip/Back, progress dots, 5 s honi hold ring
- [x] Kanaloa avatar + 7 speak clips (Masky), local-first with bucket streaming fallback
- [x] CoreWeave reasoning hook with offline fallback
- [x] MoveNet keypoint loop + gesture predicates live (buttons still work)
- [x] Gaze-triggered welcome (auto-Begin when the visitor looks at the screen)
- [x] Avatar dodge animation driven by face bbox
- [x] Cosmos 3 Reasoner NIM hook as stall-time VLM judge
- [ ] RF-DETR keypoint loop on the kiosk GPU
- [ ] Recap reel via Cosmos Generator NIM
