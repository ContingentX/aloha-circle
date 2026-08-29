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

Each deploy re-applies [`infra/site.yaml`](infra/site.yaml) (S3 + CloudFront + ACM + Route53 per environment) then builds `www` and syncs it to the environment's bucket with a CloudFront invalidation (`infra/deploy.sh` + `infra/deploy-web.sh`). The one-time OIDC role lives in [`infra/cicd.yaml`](infra/cicd.yaml) (stack `alohalive-cicd`). Set the repo variables `VITE_API_BASE_DEV` / `VITE_API_BASE_PROD` once the agent harness is hosted so the static site can reach the API.

Release flow: PR feature → `dev` (auto-deploys dev site) → PR `dev` → `production` (auto-deploys live site).

## Qodo Code Review Evidence

_Placeholder — every PR in this repo is reviewed by Qodo. PR links and findings addressed will be listed here._

| PR | Qodo findings | Resolution |
|----|---------------|------------|
| — | — | — |
