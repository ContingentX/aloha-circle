# Aloha Circle — project rules

Monorepo: `/www` (Vite React site), `/app` (Expo RN app), `/agentharness` (Node agent: API :8787 + ingest + matcher). All three share the data model in `agentharness/src/store.js`; www and app are thin clients of the harness API.

## Commands

- Harness: `cd agentharness && npm start` (API + ingest loop), `npm test` (smoke test)
- Site: `cd www && npm run dev` (proxies `/api` → :8787), `npm run build` (static → `www/dist`, deployed to the site S3 bucket (aloha-circle.com))
- App: `cd app && npx expo start`

## Rules

- All changes via pull request — never push directly to `main` (hackathon requirement; PRs are Qodo-reviewed).
- Keep the matcher deterministic and testable; LLM/agent logic goes behind the TrueForge harness boundary in `/agentharness`, not in the clients.
- Update the "Qodo Code Review Evidence" table in README.md when a PR merges.

## Auth, verification & donations (AWS)

All app data is in AWS: DynamoDB table `alohalive`, S3 verify-uploads bucket,
SES domain-proof codes, Stripe donations — served by the Lambda API in
`infra/donations/` (stack `alohalive-donations`, deployed by `infra/deploy.sh`).
Firebase is used only as the Google sign-in door (ID tokens verified in the
Lambda). Full architecture + endpoint list: `infra/README-aws-auth.md`.

## Bright Data scraper settings (Maui Needs Index)

Scraper configuration is version-controlled in `agentharness/src/sources.json` — one entry per source:
`{ id, name, url, enabled, parser, schema: { required: [...] } }`.

- The ingest loop (`agentharness/src/ingest.js`) validates every extracted CauseSignal against the source's `schema.required`. A source whose output stops validating is flagged `needs_repair` in `agentharness/data/sources.status.json` — that flag is the trigger for Bright Data scraper auto-repair.
- When adding/repairing a scraper, edit `sources.json` (never hardcode selectors in code) so settings stay reusable and version-controlled.
- Bright Data credentials go in `agentharness/.env` as `BRIGHTDATA_API_TOKEN` (never committed).
- CauseSignal shape: `{ source, url, title, causeTags[], urgency (1-5), summary, fetchedAt }`.

## Site media (/media)

Large site media (cause videos, card images) is NOT in git or the web build:
it lives in the site S3 buckets under `media/` (uploaded directly with
`aws s3 cp/sync`, both dev and prod buckets) and is referenced site-relative
as `/media/<name>`. `infra/deploy-web.sh` excludes `media/*` from its
`--delete` sync so deploys never remove it. Don't ship third-party media URLs
(e.g. buzz.masky.ai) in site code.

Small first-party brand assets (logo SVG, favicons, app icons — a few KB) are
NOT media: they ship in git under `www/public/` and are served from the site
root. Do not place build-shipped files under `www/public/media/` — the deploy
sync's `media/*` exclusion means they would never reach the bucket.
