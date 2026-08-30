# Auth, verification & donations — AWS architecture

All AlohaLive app data lives in AWS. Firebase appears in exactly one place: as
the **Google sign-in door** — the ContingentX org Firebase project
(`contingentx-b0eab`) already has a working Google OAuth client, so the site
uses `signInWithPopup` from it and sends the resulting ID token to our API,
which verifies it against Google's public certs. No app data is stored in
Google. (Swapping to Cognito later only changes the token issuer check.)

| Piece | Where |
|---|---|
| API | Lambda `alohalive-donations` behind API Gateway HTTP API (`alohalive-api`), stack `alohalive-donations`, code `infra/donations/index.mjs` |
| Data | DynamoDB table `alohalive` (single-table: `USER#uid/PROFILE`, `USER#uid/CODE`, `EXP#id/META`, `DON#sessionId/META`, `CNT#expId/period`) |
| Residency uploads | S3 `alohalive-verify-<account>` (private; presigned PUT from `/local/submit`) |
| Domain-proof email | SES from `verify@alohalive.net` (identity + DKIM in Route 53; account has production access) |
| Stripe | secret key in SSM `/alohalive/prod/STRIPE_SECRET_KEY` (**live key** — real charges) |

Function URLs are blocked account-wide (org policy) — that's why API Gateway.

## Endpoints

Public: `GET /experiences`, `POST /donate {experienceId, amountUsd}`,
`GET /spin?session_id=cs_...` (idempotent, server-side prize draw against
per-day/per-month caps, HST dates).
Public data plane (what the www tabs call; `VITE_API_BASE_DEV/_PROD` repo
variables point builds here): `GET /api/health`, `GET /api/nonprofits`
(seeded/agent-written `NPO#` items merged with verified signed-up nonprofits),
`GET /api/causes`, `POST /api/visitors {name, interests[]}` (runs the
deterministic matcher, returns `{visitor, match}`), `POST /api/locals`,
`POST /api/endorsements {local, nonprofit, verdict}`. Item shapes are
documented at the top of the "public data plane" section in
`donations/index.mjs`; seed demo data with `./infra/seed-demo-data.sh`.
The Aloha agent updates the site by writing those same DynamoDB items.
Authed (`Authorization: Bearer <Firebase ID token>`): `GET /me`,
`POST /profile`, `POST /npo/claim`, `POST /npo/send-code`,
`POST /npo/verify-code`, `POST /local/submit`, `POST /local/confirm`
(flips the profile to pending after the client's S3 PUT succeeds),
`POST /experiences` (verified nonprofits only).

## Verification model

- **Nonprofit**: claim a domain → instantly verified when the Google account's
  verified email is on that domain; otherwise a 6-digit code (hashed, 15-min
  TTL, 5 attempts) is emailed to a chosen `@domain` inbox via SES.
- **Local**: select airport (OGG only for now) + upload a bill photo via
  presigned S3 PUT → `pending`. A reviewer (later: the agent) flips
  `ver_status` to `verified` on the profile item — clients cannot.

## Deploying

`infra/deploy.sh <dev|prod>` deploys the site stack, the `alohalive-donations`
stack, and uploads the Lambda code. Frontend picks the API endpoint from
`VITE_API`, then `VITE_API_BASE` (what the deploy workflows set), then the
deployed-endpoint fallback in `www/src/appApi.js`.

## Reviewing local (bill-photo) verifications

Look at the object referenced by the profile's `ver_billKey` in the verify
bucket, then:

```sh
aws dynamodb update-item --table-name alohalive \
  --key '{"PK":{"S":"USER#<uid>"},"SK":{"S":"PROFILE"}}' \
  --update-expression 'SET ver_status = :s' \
  --expression-attribute-values '{":s":{"S":"verified"}}'
```
