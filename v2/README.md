# Family Rewards 2.0

React/TypeScript interface and Cloudflare Worker/D1 backend for the approved Hebrew prototype. This directory is independent of the existing Render/Flet application. No production data, credentials, or default passwords are included.

## Implemented

- Shared data with refresh after writes, on tab activation, and every 30 seconds while visible.
- Separate family access and parent elevation. Family access allows member selection, tasks and child reward goals. Parent elevation additionally enables redemption, individual cancellation, balance corrections, catalog management and the family goal.
- PBKDF2/SHA-256 password verifiers in secrets; hashed random session tokens in Secure/HttpOnly/SameSite cookies; same-origin JSON writes. Parent sessions expire after 30 minutes, family sessions after seven days. Leaving parent mode rotates to family access. No demo password fallback.
- Atomic balance/history writes through SQLite triggers, nonnegative balances, unique cancellation references and idempotency keys. Stale balance edits are rejected.
- History shows eight days by default, with a button expanding the list downward to six months (and a collapse button). Rolling six calendar months of history, with UTC month-end clamping. Reads hide older records; daily cleanup physically deletes them at 01:17 UTC without changing balances.
- Hebrew RTL interface, responsive navigation, goals, native keyboard-accessible dialogs, and no redundant “פעולות נוספות” panel.

## Validation

Node 24+ and Python 3.12+:

```sh
cd v2
npm ci
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run build
```

API tests run the actual Worker handlers against in-memory SQLite via a small D1-compatible adapter. They cover permissions, cookies, retries, concurrent redemptions, older-action cancellation, stale edits, catalog retirement and retention. A final Cloudflare runtime and two-device smoke test is also required.

## Cloudflare setup

Use a Cloudflare account on its free plan. Keep usage within free quotas and do not enable paid services. The Worker serves both the frontend and API on one origin; a custom domain is optional.

```sh
cd v2
npx wrangler login
npx wrangler d1 create family-rewards-v2
```

Use the database ID returned by Cloudflare:

```sh
D1_DATABASE_ID=YOUR_DATABASE_ID node scripts/configure.mjs
npx wrangler d1 migrations apply family-rewards-v2 --remote
```

Choose two **different**, private passwords: a shared family password and a parent password kept from the children. Run `npm run credentials` interactively for each password. Paste each resulting verifier into the corresponding hidden secret prompt:

```sh
npx wrangler secret put FAMILY_PASSWORD_HASH
npx wrangler secret put PARENT_PASSWORD_HASH
```

Keep password verifiers private too. Never add passwords, verifiers, service-account JSON, CSV exports or generated SQL to GitHub. `wrangler.jsonc` contains the non-secret database binding and is included in this prepared package. `.dev.vars`, `exports/` and `import.sql` are ignored. For local runtime testing use `--local` migrations and ignored `.dev.vars` with test verifiers, then `npm run build` and `npm run dev`.

## Data migration

1. Export `Members`, `Chores`, `Behavior`, `Education`, `Prizes` and `History` as UTF-8 CSV files, using those exact filenames. Also export `MonthlyLedger.csv` if available. Place files in ignored `v2/exports/`.
2. Back up the workbook. Pause writes to the old app for the final export/import so balances do not diverge.
3. Generate and validate SQL locally:

```sh
python scripts/import_sheets.py exports --output import.sql
```

4. Compare its total with `Members`, then test the import in a fresh local database:

```sh
npx wrangler d1 migrations apply family-rewards-v2 --local
npx wrangler d1 execute family-rewards-v2 --local --file import.sql
npx wrangler d1 execute family-rewards-v2 --local --command "SELECT name,points FROM members;"
```

5. Verify each balance and all catalog entries before importing the same file into an empty remote database:

```sh
npx wrangler d1 execute family-rewards-v2 --remote --file import.sql
npx wrangler d1 execute family-rewards-v2 --remote --command "SELECT name,points FROM members;"
```

`Members.Points` is authoritative: imported history does **not** add points again. Validation rejects invalid integers, unknown members, duplicate names and future timestamps. Naive timestamps are interpreted as Asia/Jerusalem and stored in UTC. History/MonthlyLedger overlaps use the maximum occurrence count from either source, preserving repeated identical actions without doubling the sheets. Imports refuse a nonempty dataset; resolve a failed import in a fresh database rather than rerunning blindly.

Imported entries are marked legacy and cannot be cancelled directly: the old sheets lack reliable action/cancellation links. Parents can instead make a documented balance correction. All new tasks, redemptions and corrections support individual cancellation. Balances survive even where old records were already purged. The old app currently retains only eight days of detailed history; MonthlyLedger may supply older activity, but deleted data cannot be reconstructed automatically. Child roles use the existing configured names (גוני and נווה); review member roles before cutover.

## Deployment and cutover

```sh
npm run deploy
```

On two devices, verify family login, task credit, shared refresh, parent login, blocked child redemption, one parent redemption, cancellation of an older entry and parent logout. Recheck balances. Switch the family link after these pass; keep Render and the original workbook available until then.

The private ChatGPT Sites prototype remains a separate UI reference and is not automatically replaced by this Cloudflare app.

## GitHub deployment

The workflow runs checks for PRs and pushes affecting `v2/`. Deployment is disabled until configured. In the GitHub environment `family-rewards-v2`, configure secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus environment variable `FAMILY_REWARDS_V2_DATABASE_ID`. Set repository variable `FAMILY_REWARDS_V2_ENABLED=true` only after the first import and smoke test. Subsequent `main` pushes affecting this app deploy after tests. Schema migration, data import and password changes remain explicit operations.

Limit the Cloudflare API token to this account's Workers deployment and D1 access. Never paste it into chat or commit it. Password secrets must already exist on the Worker. Keep automatic deployment disabled until first cutover validation.

References: [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), [Worker static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
