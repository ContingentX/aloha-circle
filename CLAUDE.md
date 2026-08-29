# AlohaLive — project rules

Monorepo: `/www` (Vite React site), `/app` (Expo RN app), `/agentharness` (Node agent: API :8787 + ingest + matcher). All three share the data model in `agentharness/src/store.js`; www and app are thin clients of the harness API.

## Commands

- Harness: `cd agentharness && npm start` (API + ingest loop), `npm test` (smoke test)
- Site: `cd www && npm run dev` (proxies `/api` → :8787), `npm run build` (static → `www/dist`, deployed to the alohalive.net S3 bucket)
- App: `cd app && npx expo start`

## Rules

- All changes via pull request — never push directly to `main` (hackathon requirement; PRs are Qodo-reviewed).
- Keep the matcher deterministic and testable; LLM/agent logic goes behind the TrueForge harness boundary in `/agentharness`, not in the clients.
- Update the "Qodo Code Review Evidence" table in README.md when a PR merges.

## Auth & verification (Firebase)

Google sign-in + nonprofit/local verification live in the ContingentX Firebase
project (`contingentx-b0eab`): named Firestore db `alohalive`, storage bucket
`contingentx-alohalive`. Full layout, data model, and the storage-rules deploy
warning: `infra/README-firebase.md`. Deploy rules with
`firebase deploy --only firestore:rules,storage --project contingentx-b0eab`.

## Bright Data scraper settings (Maui Needs Index)

Scraper configuration is version-controlled in `agentharness/src/sources.json` — one entry per source:
`{ id, name, url, enabled, parser, schema: { required: [...] } }`.

- The ingest loop (`agentharness/src/ingest.js`) validates every extracted CauseSignal against the source's `schema.required`. A source whose output stops validating is flagged `needs_repair` in `agentharness/data/sources.status.json` — that flag is the trigger for Bright Data scraper auto-repair.
- When adding/repairing a scraper, edit `sources.json` (never hardcode selectors in code) so settings stay reusable and version-controlled.
- Bright Data credentials go in `agentharness/.env` as `BRIGHTDATA_API_TOKEN` (never committed).
- CauseSignal shape: `{ source, url, title, causeTags[], urgency (1-5), summary, fetchedAt }`.
