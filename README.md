# AlohaLive

**Don't just visit Maui. Meet Maui.** — [alohalive.net](https://alohalive.net)

AlohaLive matches incoming visitors with Maui locals, live local causes, and donated experiences — and turns each match into a real action. The physical experience is the **Aloha Circle** at Kahului Airport (OGG). Built for the [Agent Harness Hackathon](https://www.wemakedevs.org/blogs/agent-harness-hackathon-kick-off) (TrueForge × Qodo × Bright Data).

See [PLANFILE.md](PLANFILE.md) for the full plan.

## Structure

| Dir | What |
|-----|------|
| [`/www`](www) | Vite + React website (static build → S3 behind alohalive.net) |
| [`/app`](app) | Expo / React Native mobile app |
| [`/agentharness`](agentharness) | The Aloha Agent: API, continuous Maui Needs Index ingest, matcher |

## Quickstart

```bash
# 1. Start the agent harness (API on :8787 + ingest loop)
cd agentharness && npm install && npm start

# 2. Start the website (proxies /api to :8787)
cd www && npm install && npm run dev
# → http://localhost:5173

# 3. (optional) Mobile app in Expo Go; opt into LAN binding for device access
ALOHALIVE_HOST=0.0.0.0 npm --prefix agentharness start
cd app && npm install && npx expo start
# in the app, set API base to http://<your-LAN-IP>:8787
```

LAN binding is only for the visitor-facing API. The MCP endpoint and `/api/agent/*` control surface remain loopback-only even when `ALOHALIVE_HOST=0.0.0.0` is set.

Sign up as a visitor on the site — you'll get an instant match against the seeded locals/causes. The harness re-ingests CauseSignals continuously from `agentharness/src/sources.json`.

## TrueForge vertical slice

The agent harness also exposes a bounded TrueForge workflow: a persistent session reads AlohaLive context through MCP, recomputes the deterministic match in a Daytona sandbox, and pauses for human approval before it can persist one idempotent demo introduction-request record. The approval creates a short-lived, one-use capability for the exact pending tool arguments, so a direct MCP call cannot bypass the checkpoint. It does not send a message, make a donation, deploy anything, or perform a real-world introduction.

The default test suite is hermetic and needs no provider credentials:

```bash
nvm use 22
npm --prefix agentharness ci
npm --prefix agentharness test
```

The live evidence test is intentionally opt-in because it requires a locally configured TrueForge instance, model, Daytona sandbox provider, and MCP connector. See [`agentharness/TRUEFORGE.md`](agentharness/TRUEFORGE.md) for the exact setup, denial/approval checks, and reconnect proof.

## Branches & Deploys

Day-to-day work happens on **`dev`** (the default branch); **`production`** is the live release branch. GitHub Actions deploys on push, assuming the `alohalive-github-deploy` IAM role via OIDC (repo variable `AWS_DEPLOY_ROLE_ARN`):

| Branch | Workflow | Deploys to |
|--------|----------|-----------|
| `dev` | [deploy-dev.yml](.github/workflows/deploy-dev.yml) | https://dev.alohalive.net |
| `production` | [deploy-prod.yml](.github/workflows/deploy-prod.yml) | https://alohalive.net (www redirects to apex) |

Each deploy re-applies [`infra/site.yaml`](infra/site.yaml) (S3 + CloudFront + ACM + Route53 per environment) then builds `www` and syncs it to the environment's bucket with a CloudFront invalidation (`infra/deploy.sh` + `infra/deploy-web.sh`). The one-time OIDC role lives in [`infra/cicd.yaml`](infra/cicd.yaml) (stack `alohalive-cicd`). CI discovers the deployed API Gateway endpoint from the `alohalive-donations` stack so the site and deployment smoke test use the same backend.

Release flow: PR feature → `dev` (auto-deploys dev site) → PR `dev` → `production` (auto-deploys live site).

## Qodo Code Review Evidence

| PR | Qodo findings | Resolution |
|----|---------------|------------|
| [#18](https://github.com/ContingentX/alohalive/pull/18) | 6 bugs, 3 rule violations (review arrived after merge) | Findings are addressed in the focused public-API hardening follow-up. |
| [#23](https://github.com/ContingentX/alohalive/pull/23) | 2 bugs across incremental reviews, 1 rule violation | Require authenticated, single-write daily-limited nonprofit submissions; record this PR's review evidence. |
| [#29 scroll-world hero](https://github.com/ContingentX/alohalive/pull/29) | 4 findings: hero never releases at end-of-track so the app stays buried (High), engine has no teardown so StrictMode double-mounts it, phones fall back to 1080p desktop clips, missing evidence row in this table | All four addressed in [#30](https://github.com/ContingentX/alohalive/pull/30): end-of-track handoff with `.sw-done` release, full unmount from `mountScrollWorld`, posters-only on phones without mobile encodes, and these rows |
| [#30 handoff fix](https://github.com/ContingentX/alohalive/pull/30) | 3 findings: evidence row missing (reviewed before the row commit landed), clip fetches survive engine teardown so StrictMode replay downloads 1080p media twice, scroll-queued `read()` RAF outlives unmount and can touch detached nodes | All addressed in-PR: rows added; clip fetches now use AbortControllers aborted on unmount; the queued read RAF is tracked + cancelled and `read()` guards on disposal |
| [#33 aloha-circle.com domain](https://github.com/ContingentX/alohalive/pull/33) | 3 findings: evidence row missing, donations stack template lived at `infra/donations.yaml` instead of under `infra/donations/`, and `WithAlt` fires on `AltDomainName` alone so an empty `AltHostedZoneId` fails mid-deploy in ACM/Route53 instead of up front | All addressed in-PR: this row; template moved to `infra/donations/donations.yaml` (deploy.sh updated); CloudFormation `Rules` now assert the alt domain/zone pair is provided together, rejecting half-specified invocations at changeset time |
| [#36 Aloha Circle rebrand](https://github.com/ContingentX/alohalive/pull/36) | 5 findings: logo/favicons served from the site root instead of `/media/` (rule), evidence row missing, final-scene handoff translation ignores `prefers-reduced-motion`, app bridge header still said AlohaLive, and Stripe checkout + SES verification emails still branded AlohaLive | 4 addressed in-PR: this row; reduced-motion users get a cross-dissolve instead of the full-viewport translation; bridge header rebranded; Stripe product name + SES sender/subject/body rebranded (verified `verify@alohalive.net` SES identity retained). The `/media/` move was declined with evidence: `deploy-web.sh` syncs `dist/` with `--exclude "media/*"`, so build-shipped assets under `/media/` would never reach the bucket — the rule targets large S3-only media, now clarified in CLAUDE.md |
| [#19 prod deploy](https://github.com/ContingentX/alohalive/pull/19) | 19 findings (12 bugs, 7 rule violations): spin race + lost retry path, raceable code-attempt cap, unpaginated scans, `VITE_API` vs `VITE_API_BASE` mismatch, hard-coded dev bridge in the app, non-OGG boarding passes verifying travelers, seed script dropping throttled writes, upload-before-pending trap, silent profile errors, missing CauseSignal fields, matcher tie-break, and more | Triaged in follow-up PR to `dev` (`fix/qodo-pr19-feedback`): 13 fixed; Stripe Connect payouts, per-env backend stacks, endorsement auth, and unforgeable traveler evidence deferred as product/infra decisions; static nonprofit rail and template location rejected as intentional |
