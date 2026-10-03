# team-18

## Project
Maui kiosk: visitors complete the Breath of Aloha ritual with Kanaloa, a water avatar. Gesture tracking advances each blessing; finished sessions ingest into team-18 VAST VSS for search and replay.

**Stack:** Electron kiosk; RF-DETR (Roboflow) / MoveNet pose; Masky avatar; VAST S3 PUT + VSS batch-sync (Cosmos Reason, Cosmos Embed, YOLO); W&B Inference by CoreWeave; Cosmos Reasoner NIM; Cosmos Generator NIM; Cursor Cloud Agents
**Code:** https://github.com/ContingentX/aloha-circle
**Live app:** Electron kiosk on the Aloha Circle screens (no public URL). Searchable sessions: https://team-18-vss.thecosmoslabs.com/search
**Supplementary:** https://aloha-circle.com · merged kiosk train https://github.com/ContingentX/aloha-circle/pull/44

## Feedback
Using the VM was a very bad experience. Selecting files didn't show the Open button because it was below the screen, so I had to resize the window. I never want to use this VM again, and forcing us to use it was unpleasant. Cursor agents in the cloud are fast and great: I was using Buzz and having Fable and Grok (the Cursor agent) talk within Buzz to build the app. It came out well, and I'm happy with it, though I need to make sure the NVIDIA model for gesture recognition is working.
