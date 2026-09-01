# Aloha Circle — Planfile

**Don't just visit Maui. Meet Maui.**

AlohaLive matches incoming visitors with Maui locals, live local causes, and real experiences — and turns each match into an action (meet a local, donate, volunteer, win a donated experience). The physical anchor is the **Aloha Circle** at OGG (Kahului Airport): a 10-ft round podium where a robotic hula greeter and an on-screen AR character welcome travelers while they wait for bags. Built for the **Agent Harness Hackathon** (wemakedevs × TrueFoundry, Aug 24–30 2026), live at **alohalive.net**.

## The one magical loop

```
traveler → live local cause → agent match → shared airport experience → measurable action
```

Everything else (robot, AR, airline integration, vendor marketplace, passenger pre-recognition) is product story layered on top of this loop.

## Repo layout — three core parts

| Dir | What | Stack |
|-----|------|-------|
| `/www` | Public website: visitor/local/nonprofit signup, live needs feed, match reveal | Vite + React, static build → S3 + CloudFront (Route 53: aloha-circle.com, already provisioned) |
| `/app` | Mobile companion: signup + match feed, later AR character + dance | Expo / React Native |
| `/agentharness` | The Aloha Agent: HTTP API, continuous ingest ("Maui Needs Index"), matcher | Node (Express), later TrueForge harness + Bright Data |

All three share one data model; `/www` and `/app` are thin clients of the agentharness API.

## Data model

- **Visitor** — name, interests[], availability, groupType, desiredInvolvement
- **Local** — name, town, interests[], causes[], verified flag (locals are the trust layer)
- **Nonprofit** — name, website, causeTags[], needs[]
- **CauseSignal** — scraped/ingested record: `{ source, url, title, causeTags[], urgency, summary, fetchedAt }` — the output of the Maui Needs Index pipeline
- **Endorsement** — local × nonprofit verdict: `helping_now | generally_helping | not_sure | causing_concern` (builds the local reputation graph)
- **Match** — visitor × local × cause + why + suggestedAction

## MVP (this PR) — one small working version of each part

1. **`/agentharness`** — Express API on `:8787` (visitors, locals, nonprofits, causes, endorsements, matches), JSON-file store, seed data, and a **continuous ingest loop**: reads `src/sources.json` (version-controlled scraper config), extracts CauseSignals, validates against the expected schema, and flags a source `needs_repair` when the shape breaks — the exact seam where Bright Data's auto-repair plugs in.
2. **`/www`** — Vite React site: visitor signup → instant match reveal, local signup + "Is this helping Maui?" endorsements, nonprofit signup, live needs feed. `npm run build` produces the static bundle for the existing S3 bucket.
3. **`/app`** — Expo app: configurable API base, visitor signup, match card. Runs in Expo Go.

Matching in the MVP is deterministic (interest overlap + shared cause tags + urgency boost) so it's testable without any keys. The LLM/agent brain is a clean interface to swap in next.

## Phase 2 — hackathon requirements (after Seth tests MVP)

1. **Bright Data** (required): replace fixture parsers in the ingest loop with Bright Data Scraper Studio driven from the terminal; scraper settings stay version-controlled in `agentharness/src/sources.json` + `CLAUDE.md` (judges look for config in the project rules file); demo the break-one-source → detect → auto-repair → agent still fed flow. $50 credits: brdta.com/wemakedevs.
2. **TrueForge** (required): wrap the matcher as a TrueForge parent agent with three subagents — **Local Scout**, **Cause Scout**, **Experience Scout** — persistent sessions (same session moves phone ↔ airport screen), and `ask_human_approval` gating sensitive actions (intros, donations, recognition opt-in).
3. **Qodo** (required for Q Branch track): every PR reviewed by Qodo; keep the "Qodo Code Review Evidence" section in README updated with PR links + findings addressed.
4. **Deploy** `/www` build to the S3 bucket behind aloha-circle.com.
5. **Vendor console + prize mechanics**: donated inventory (snorkel seats, heli rides), decrement on win, exposure stats.
6. **Aloha Circle screen mode**: `/www` fullscreen kiosk route for the podium monitor; dance-as-onboarding (gesture choices → preference signals).

## Hackathon submission checklist

- [x] Open-source public repo
- [ ] All changes via PRs (no direct pushes to main) — this scaffold is PR #1
- [ ] TrueForge harness running the agent loop
- [ ] Bright Data pipeline inside the agentic workflow, config version-controlled, auto-repair demoed
- [ ] Qodo review on every PR + "Qodo Code Review Evidence" README section
- [ ] Optional: blog post (Field Report track), social posts, star TrueForge repo

## 3-minute demo script (judging)

QR scan → avatar asks "What brought you to Maui?" → three subagents visibly search (Bright Data live) → match reveal (Meet: Keoni, Lahaina / Cause: reef restoration / Today: Saturday cleanup) → "84 verified locals endorsed this org" trust graph → 10-second hula → prize won, vendor inventory decrements → persistent session: phone notification "Leilani accepted your introduction."

## Open questions for Seth

- Backend hosting for agentharness in production (the S3 site is static — Lambda/Fargate/EC2? or keep harness at the airport kiosk and sync?)
- Adopt Open Session License / llm-turn-history.jsonl here like HumanHarness?
- Verified-local verification mechanism (ID? kama'aina? invite graph?)
