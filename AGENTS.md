# AGENTS.md — rules for agents working in this repo

## Branch & PR policy (the important one)

- **Always open pull requests against `dev`.** Never target `production` or `main`, and never push directly to any long-lived branch.
- **Promotion to production is manual and human-owned:** Seth opens the `dev` → `production` PR when dev is ready. Do not open, approve, or merge that PR yourself.
- Deploys are automatic on merge: `dev` → dev.aloha-circle.com, `production` → aloha-circle.com (alohalive.net 301s to it) (GitHub Actions, OIDC).
- Branch names: `feat/…`, `fix/…`, `docs/…`, `infra/…`. One concern per PR; PRs are Qodo-reviewed.

## Repo layout

Monorepo: `/www` (Vite React site), `/app` (Expo RN app), `/agentharness` (Node agent: API :8787 + ingest + matcher), `/infra` (CloudFormation + deploy scripts, incl. the `alohalive-donations` Lambda API).

## Working rules

- See `CLAUDE.md` for project commands, data-model rules, and the Bright Data scraper conventions — it applies to all agents, not just Claude.
- Keep the matcher deterministic and testable; LLM/agent logic stays behind the harness boundary in `/agentharness`, never in the clients.
- `www` builds are static; API location is baked in via `VITE_API_BASE` at build time. Client code must tolerate the API being unset/unreachable (visible error, no crashes).
- Update the "Qodo Code Review Evidence" table in README.md when a PR merges.

## Cursor Cloud specific instructions

- Node 22 comes from nvm. Put that version's `bin` first on `PATH` (`nvm use 22`, then `dirname "$(nvm which 22)"`). Another `node` earlier on `PATH` is not the project runtime.
- `npm ci` in `agentharness` fails unless you pass `--legacy-peer-deps`: the lockfile omits the optional `jose@^5` peer pulled in by `@brightdata/mcp`. Use the same flag for `www` and `app`.
- The local demo needs no AWS, Stripe, Firebase, Bright Data, or TrueForge credentials. `npm --prefix agentharness test` is hermetic. Ingest reports `needs_repair` for `broken-source-demo` and `brightdata-live-example` when no Bright Data token is configured; the fixture sources still load.
- API: `npm --prefix agentharness start` on `http://127.0.0.1:8787`. Site: `npm --prefix www run dev -- --host 0.0.0.0 --port 5173` (Vite proxies `/api` to the harness). Hello-world is the "What brought you to Maui?" form, which posts `/api/visitors` and renders "Your Maui Match".
- `app` (Expo) installs with the same `npm ci`. Leave it stopped on boot; it needs a device or simulator.
