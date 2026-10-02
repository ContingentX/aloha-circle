# Aloha Circle kiosk — hackathon plan (VAST SF, 2026-10-02)

The kiosk turns the Aloha Circle in Maui into a guided **Breath of Aloha**
experience: a camera-facing screen, headphones, and Kanaloa — a water-spirit
Hawaiian girl avatar — leading each visitor through the honi ihu greeting and
the eyes/ears/nose/heart blessing sequence, verifying each gesture with pose
estimation and reacting in real time.

## Architecture

```
┌────────────────────────── kiosk (Electron, this app) ──────────────────────────┐
│  camera feed ──► frame sampler ──► Roboflow Inference (RF-DETR Keypoint, GPU)  │
│                                        │ keypoints                             │
│  stage machine ◄── gesture events ◄────┘                                       │
│       │                                                                        │
│       ├─► Kanaloa speak clips (Masky, pre-rendered)  ─► avatar card + 🎧      │
│       └─► CoreWeave (W&B Inference) ─► personalized lines / adaptive coaching  │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Sponsor / tool integration map

| Piece | Tool | Status | Notes |
|---|---|---|---|
| Pose estimation | **Roboflow RF-DETR Keypoint** (NVIDIA team's rec) | planned | Local `roboflow/inference` GPU container on the kiosk; ~10 fps downscaled frames; COCO-17 keypoints → gesture predicates in `renderer/pose.js`. MoveNet (TF.js) as zero-install fallback. |
| Gesture → stage logic | this app | ✅ MVP | Deterministic predicates (wrists near eyes/ears/nose, hands stacked on chest, near-field face for honi) with 1.5 s dwell; buttons simulate for now. |
| Avatar + voice | **Masky** (avatar `hPozOmvYl2TGkeDxAORy`) | ✅ | 7 pre-rendered lip-synced speak clips (one per stage) in `media/kiosk/`. Next: live Masky conversation turns so Kanaloa answers visitors dynamically. |
| In-experience reasoning | **CoreWeave / W&B Inference** | ✅ hook | Key in SSM `/alohaintelligence/production/coreweave_api_key`; `src/reasoning.cjs` composes personalized blessings; W&B Weave can trace every interaction for the demo. |
| Realtime avatar dodge | pose bbox + CSS transition | planned | Kanaloa's card slides to the other side of the screen when the visitor's face bbox overlaps it. |
| Video agent (Cursor?) | TBD at venue | open | Seth to confirm what the sponsor actually offers; candidate uses: auto-generated recap reel of each visitor's ritual, or agent-driven QA of the kiosk flow. |

## Demo script (90 s)

1. Walk up → attract screen over live camera.
2. Begin → Kanaloa welcome clip in headphones.
3. Honi ihu: forehead to the screen rest, 5-second breath ring.
4. Eyes → ears → nose → heart, each gesture advancing the stage (buttons today,
   RF-DETR tomorrow).
5. Mahalo closing + personalized CoreWeave blessing.

## MVP milestones

- [x] `/kioskapp` Electron shell: fullscreen camera, stage machine, Next/Skip/Back, progress dots, 5 s honi hold ring
- [x] Kanaloa avatar + 7 speak clips (Masky), local-first with bucket streaming fallback
- [x] CoreWeave reasoning hook with offline fallback
- [ ] RF-DETR keypoint loop + gesture predicates live
- [ ] Gaze-triggered welcome (auto-play when the visitor looks at the screen)
- [ ] Avatar dodge animation driven by face bbox
- [ ] Recap reel / video agent integration (pending sponsor details)
