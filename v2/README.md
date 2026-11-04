# Family Rewards 2.0

React/TypeScript interface and Cloudflare Worker/D1 backend for the current Hebrew family points and rewards app. This directory is independent of the legacy Render/Flet application. No family data, credentials, or default passwords are included. See the [product overview](../README.md) and [onboarding and release plan](ONBOARDING_AND_RELEASES.md).

## Implemented

- Shared data with refresh after writes, on tab activation, and every 30 seconds while visible.
- Separate family access and parent elevation. Family access allows member selection, tasks and child reward goals. Parent elevation additionally enables redemption, individual cancellation, balance corrections, catalog management and the family goal.
- PBKDF2/SHA-256 password verifiers, initially in runtime secrets, with in-app updates in private D1 storage. Both passwords accept at least four characters. Hashed session tokens use Secure/HttpOnly/SameSite cookies and same-origin JSON writes. Parent sessions last 30 minutes and family sessions seven days. No demo password fallback.
- Atomic balance/history writes through SQLite triggers, nonnegative balances, unique cancellation references and idempotency keys. Stale balance edits are rejected.
- History shows eight days by default, with a button expanding the list downward to six months (and a collapse button). Rolling six calendar months of history, with UTC month-end clamping. Reads hide older records; daily cleanup physically deletes them at 01:17 UTC without changing balances.
- Hebrew RTL interface, responsive navigation, goals, native keyboard-accessible dialogs, and no redundant “פעולות נוספות” panel.
- Activities/prizes are sorted by points, low to high. History has date/type filters and a sticky expansion/collapse control; choosing a date expands the searchable range to six months. The home feed shows the latest four actions regardless of age.
- The monthly family goal uses current-month history in Israel, independently of available balances. Prize spending/refunds are excluded; cancelled new actions stop contributing. Legacy labels identify prize redemptions and retain recorded correction/cancellation deltas. Personal goals use the child's available balance. No ongoing separate monthly ledger is needed.

## First-run status

One Worker and D1 database serve one family. Newly provisioned instances have an invitation-gated parent wizard for adding/reordering children, opening balances, optional activities/prizes, the monthly goal and review. Existing family installations bypass it. Parents need not appear as point-earning participants. See [PROVISIONING.md](PROVISIONING.md) for the local preparation tool and Cloudflare pilot requirements. Provisioning does not yet create Cloudflare resources automatically; guided workbook import remains future work. Parent password recovery is documented in [PASSWORD_RECOVERY.md](PASSWORD_RECOVERY.md). Managed pilot/selected/all rollout is implemented but inactive pending protected credentials and cutover; see [RELEASES.md](RELEASES.md).

## Validation

Node 24+ and Python 3.12+:

Check out the `family-rewards-v2` branch first (`git clone --branch family-rewards-v2 https://github.com/amir-kedem/family_rewards.git`). Run the commands below from the repository root.

```sh
cd v2
npm ci
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run build
```

API tests run the actual Worker handlers against in-memory SQLite via a small D1-compatible adapter. They cover permissions, cookies, retries, concurrent redemptions, older-action cancellation, stale edits, catalog retirement and retention. The isolated Cloudflare pilot was completed by the maintainer with successful onboarding and normal two-device use. New features still need their own runtime smoke checks.

## Cloudflare setup

Use a Cloudflare account on its free plan. Keep usage within free quotas and do not enable paid services. The Worker serves both the frontend and API on one origin; a custom domain is optional.

```sh
cd v2
npx wrangler login
npx wrangler d1 create family-rewards-v2
```

Use the database ID returned by Cloudflare:

For a new instance, use a unique Worker/database name and its own database ID. The checked-in `wrangler.jsonc` targets the current family. After generating config, set its Worker `name` and D1 `database_name` to the new instance's names, keeping binding `DB`; review the target before deploying. Never deploy the current family's config unchanged to another family. The helper currently replaces the database ID only.

The existing family's schema was created through the dashboard. Do not rerun its initial migration without first reconciling migration tracking. The migration command below is for a fresh, uninitialized database.

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

For browser-based bootstrap, open `/password-setup` on the deployed app and add the generated values as **Worker runtime Secrets** under Settings → Variables and Secrets, outside Build settings, then Deploy. Build secrets alone are unavailable to the API.

After setup, parents update either password under **ניהול → סיסמאות**. Verifiers are stored in D1's `password_credentials` table, created on the first change, and take precedence over bootstrap Worker secrets. Updating the family password invalidates family sessions; updating the parent password invalidates parent sessions. The current parent receives a fresh session. Changing a bootstrap secret alone does not override an in-app password change.

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

That overlap rule handles exact timestamp matches. Rows recorded a few seconds apart require reviewed normalization before using the importer; it does not reconcile those automatically. Review participants, explicit roles, ordering and the default child before importing another family's data. The historical child-name rule below must be replaced by explicit role mapping in the planned onboarding importer.

Imported entries are marked legacy and cannot be cancelled directly: the old sheets lack reliable action/cancellation links. Parents can instead make a documented balance correction. All new tasks, redemptions and corrections support individual cancellation. Balances survive even where old records were already purged. The old app currently retains only eight days of detailed history; MonthlyLedger may supply older activity, but deleted data cannot be reconstructed automatically. Child roles use the existing configured names (גוני and נווה); review member roles before cutover.

## Deployment and cutover

```sh
npm run deploy
```

On two devices, verify family login, task credit, shared refresh, parent login, blocked child redemption, one parent redemption, cancellation of an older entry and parent logout. Recheck balances. Switch the family link after these pass; keep Render and the original workbook available until then.

The private ChatGPT Sites prototype remains a separate UI reference and is not automatically replaced by this Cloudflare app.

## GitHub deployment

The active instance uses Cloudflare Workers Builds with production branch `family-rewards-v2`, root directory `v2`, build command `npm ci && npm run build`, and deploy command `npx wrangler deploy`. A commit to that branch deploys to the current family automatically. It does not update other installations.

The older `.github/workflows/family-rewards-v2.yml` is a separate opt-in Actions path targeting `main` and `family-rewards-v2-backend`. Its deployment job requires `FAMILY_REWARDS_V2_ENABLED=true`, environment secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, and variable `FAMILY_REWARDS_V2_DATABASE_ID`. It is not the active Workers Builds integration or a multi-instance release workflow. Use one deployment owner per instance.

The planned central release flow is described in [ONBOARDING_AND_RELEASES.md](ONBOARDING_AND_RELEASES.md). It will deploy approved versions to selected or all registered private instances while preserving their individual databases, credentials and settings. The manual workflow is now implemented, but it requires explicit activation and cutover before use. See [RELEASES.md](RELEASES.md).

Before releases, also check password updates, mobile header alignment, sorting, monthly/personal goals, and history date/type filters on two devices. Use test data for destructive checks. Limit deployment tokens to their intended account/resources and keep them out of chat/source.

References: [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), [Worker static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
