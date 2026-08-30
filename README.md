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
| [#23](https://github.com/ContingentX/alohalive/pull/23) | 1 bug, 1 rule violation | Require authenticated, atomically quota-bound nonprofit submissions; record this review evidence. |
