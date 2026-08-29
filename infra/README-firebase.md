# Firebase (auth + verification data)

AlohaLive uses the **ContingentX org Firebase project** (`contingentx-b0eab`) for
Google sign-in — the Google OAuth client and Auth config there are shared with
contingentx.com. AlohaLive's data is isolated inside that project:

| Resource | Value |
|---|---|
| Web app | `alohalive-www` (`1:773876661627:web:83f06abdb3735d605291de`) |
| Firestore | **named database `alohalive`** (never the `default` database — that belongs to contingentx.com) |
| Storage | bucket `contingentx-alohalive` (verification uploads) |
| Auth providers | Google, Email link (passwordless — used for nonprofit domain proof) |
| Authorized domains | alohalive.net, www.alohalive.net, dev.alohalive.net, localhost, 127.0.0.1 |

A standalone `alohalive` Firebase project exists but is parked: enabling Auth
requires billing and the billing account is at its project-link quota. Migrate
there later if isolation becomes worth the quota-increase ticket.

## Deploying rules

```sh
firebase deploy --only firestore:rules,storage --project contingentx-b0eab
```

`firebase.json` scopes Firestore rules to the named `alohalive` database and
storage rules to the `alohalive-verify` deploy target (→ bucket
`contingentx-alohalive`, mapped in `.firebaserc`).

**Warning:** never deploy storage rules without the target mapping. An untargeted
`"storage": {"rules": ...}` block releases to the project's *default* bucket
(`contingentx-b0eab.firebasestorage.app`), which carries contingentx.com's own
rules (ruleset `31d4c79c…`, restorable via the firebaserules API releases PATCH).

## Data model (Firestore db `alohalive`)

- `users/{uid}` — profile + role (`traveler` | `local` | `nonprofit`), `airport`
  (only `OGG` for now), and `verification: { status, method, … }`.
  - Locals: `method: 'bill-photo'`, upload at `verify/{uid}/bill.*` in the bucket;
    client can only reach `status: 'pending'`.
  - Nonprofits: `domain` + `verification` with `method: 'google-domain' | 'email-link'`.
- `domainProofs/{domain}` — `{ claimedBy, proofEmail, verifiedAt }`. Rules only
  allow a write when the writer's **verified auth email is on that domain**; this
  is the entire nonprofit domain-ownership proof. A user doc may only set
  `verification.status: 'verified'` when its claimed domain's proof names its uid.
- `experiences/{id}` — nonprofit-donated experiences for the donation wheel:
  `{ npoUid, title, value, minDonation, perDay, perMonth, active }`. Public read;
  writes restricted to the owning nonprofit.

## Reviewing local (bill-photo) verifications

Until the agent handles review: Firebase console → Storage → `contingentx-alohalive`
→ `verify/{uid}/`, check the document, then set that user's
`verification.status` to `verified` in Firestore db `alohalive` (console or Admin
SDK — both bypass rules; clients cannot self-verify).
