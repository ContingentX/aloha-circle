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

# 3. (optional) Mobile app in Expo Go
cd app && npm install && npx expo start
# in the app, set API base to http://<your-LAN-IP>:8787
```

Sign up as a visitor on the site — you'll get an instant match against the seeded locals/causes. The harness re-ingests CauseSignals continuously from `agentharness/src/sources.json`.

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
| [#19 prod deploy](https://github.com/ContingentX/alohalive/pull/19) | 19 findings (12 bugs, 7 rule violations): spin race + lost retry path, raceable code-attempt cap, unpaginated scans, `VITE_API` vs `VITE_API_BASE` mismatch, hard-coded dev bridge in the app, non-OGG boarding passes verifying travelers, seed script dropping throttled writes, upload-before-pending trap, silent profile errors, missing CauseSignal fields, matcher tie-break, and more | Triaged in follow-up PR to `dev` (`fix/qodo-pr19-feedback`): 13 fixed; Stripe Connect payouts, per-env backend stacks, endorsement auth, and unforgeable traveler evidence deferred as product/infra decisions; static nonprofit rail and template location rejected as intentional |
