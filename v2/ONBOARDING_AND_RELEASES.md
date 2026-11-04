# New-family onboarding and maintainer-controlled releases

**Status: implementation in progress.** Private target configuration, local provisioning preparation, invitation ownership, draft/resume and the four-step parent wizard are implemented and locally tested. The maintainer has completed the isolated Cloudflare pilot and reported successful onboarding and normal app use across devices. Parent password recovery and a manual, version-pinned pilot/selected/all workflow are implemented and locally tested. Managed rollout is inactive until the maintainer configures protected credentials and completes deployment cutover. Guided migration and additional parent editing/tour features remain future work. See [PROVISIONING.md](PROVISIONING.md).

## Direction

Each family gets a private instance, its own URL and its own D1 database. One application is maintained centrally; the maintainer chooses when to release updates. A shared multi-family login service is outside this first phase.

Recommended initial hosting: the maintainer provisions instances in a managed Cloudflare account and operates releases. Parents only need their app URL and wizard. Separately owned hosting can follow later with explicit deployment access or an update agent. A GitHub fork alone does not receive updates automatically.

Separate databases isolate application data, but the hosting administrator still has infrastructure access. This is not end-to-end encryption. Explain hosting ownership during setup.

## Parent journey

| Step | Parent action | Result |
| --- | --- | --- |
| 1. Welcome and claim | Open a private invitation and create separate parent/family passwords, minimum four characters | Setup belongs to that parent; explain which code children may use |
| 2. Children | Add names/optional icons, set order and choose the default child | Explicit roles/order without hard-coded names; parents need not earn points |
| 3. Starting point | Start at zero, enter reviewed opening balances, or select existing-data import | Opening balances do not inflate monthly progress |
| 4. Activities and prizes | Preview a small starter catalog, select items, edit points and add personal items | Only approved items are saved; lists are sorted by points |
| 5. Monthly goal | Choose the target and confirm timezone, initially Israel | Explain that prize spending does not reduce earned progress |
| 6. Review and start | Review participants, order, balances, catalog and goal, then finish | A complete instance opens on the default child |
| 7. First use | Share the family URL/code, optionally add to the home screen, and try a skippable tour | A real activity earns points; a tour never silently creates history |

Allow Back and private draft/resume. Later edits belong in parent mode. Existing families skip setup after upgrades; preserve their data. The removed one-time “הבית כמעט מוכן” card is not an onboarding flow.

## Provisioning and secure first run

The maintainer creates an instance before inviting a parent: unique Worker/database names, correct `DB` binding, initial schema and explicit awaiting-setup state. Never copy the current family's binding into a new instance.

Use a random, expiring, single-use setup token stored as a verifier. An empty database must not make public setup claimable by anyone who finds the URL. Rate-limit claims and enforce same-origin requests. Exchange a successful claim for a secure setup session and consume the token atomically. Keep tokens out of query strings, logs and analytics; use a fragment-to-POST handoff and clear the fragment.

Persist setup ownership and the parent credential at claim; later drafts are private to that owner. Block family access until completion. Finalize participants, opening balances, catalog, settings and completion state atomically. Retried requests must not duplicate children or points. Expired invitations or lost setup access need a maintainer/verified-owner recovery flow.

Add explicit setup state/version, participant order/role, family display name, timezone and schema version. Backfill populated existing instances as complete before enabling setup, retaining ordering, passwords, balances and catalog. Keep raw passwords out of storage/responses and use the existing verifier/private credential store.

## Existing-data import

Import is an alternative to starter data, not a requirement for new families:

1. Accept a workbook or CSV bundle through parent/setup-owner access.
2. Map sheets and fields, using `Members` balances as authoritative.
3. Review participant selection, explicit roles, order and default child.
4. Use `MonthlyLedger` for older activity and match overlap with `History` one-to-one. Preserve genuine repeats; flag ambiguous timestamps for review instead of guessing.
5. Preview balances, catalog totals, retained records and ignored older rows. Explain that history is not credited again.
6. Validate against the target schema and commit once atomically; reject imports over initialized data.

Explain legacy cancellation limits and the balance-correction option. Parents retain their workbook backup. Do not retain raw uploads unnecessarily or commit them publicly.

## Maintainer-controlled releases

The intended experience is **develop → test → pilot → choose version → deploy to selected families or all managed families**.

### Release lanes

- Develop v2 against disposable preview data and keep a pilot instance for maintainer checks.
- Today's family instance auto-deploys `family-rewards-v2`; this is not a controlled release channel for other families.
- Tag immutable versions after tests pass, with release notes and a schema compatibility range.
- Add a manual GitHub Actions workflow with a pinned version input and targets: pilot, selected instances, or all managed instances.
- Manual dispatch needs the workflow on GitHub's default branch. Add it deliberately without silently replacing the legacy `main` application. Deployment checks out the selected v2 release tag.
- Give production instances one deployment owner. Disable/disconnect branch-triggered Workers Builds for managed production before the release workflow takes over, so a development push cannot release to all families.

Committing is separate from releasing to other families. The maintainer starts rollout when ready. New families start on the latest approved stable version.

### Target configuration and rollout

Keep a private registry of opaque instance ID, account reference, Worker name, D1 ID/name, URL, channel, current release and schema version. Do not publish family names, contacts or usage. Deployment credentials belong in protected CI configuration; application passwords are not release inputs.

Validate each target against the registry and generate its Wrangler configuration. The current `configure.mjs` changes only the database ID; extend it to validate unique Worker/database names too. Abort on a binding mismatch. Never deploy a shared hard-coded family configuration across the fleet.

Build/test the selected source once and deploy the same artifact with each target's bindings. Serialize changes per instance, isolate target failures and stop promotion on pilot failure. Record per-target before/after versions and status. “Deploy to all” must report partial failures and support retrying failed targets.

### Data safety and rollback

Normal releases update code, not family data. Do not reseed catalogs, reset settings/passwords, run imports, unnecessarily clear sessions or replace databases.

Use versioned schema migrations, preflight checks and a recovery point/export before migration. Reconcile the current manually initialized schema before automating migration tracking. Prefer backward-compatible additions so previous code can run. Test migrations on fresh databases and imported fixtures.

Code rollback selects a previous approved version. Database recovery is separate and may discard newer activity; never automatically restore old data because code deployment failed. Incompatible migrations need a tested recovery/forward-fix plan before rollout.

Keep family URLs stable. Add an app-version indicator in parent mode and a refresh notice for new versions. Never force a reload during a point action or unsaved parent form.

### Capacity

Cloudflare D1 Free currently allows 10 databases per account, including pilot/staging, with shared account usage quotas. This supports a small initial group without promising unlimited free hosting. Agree on paid hosting or separately owned accounts before exceeding capacity; do not upgrade billing automatically.

## Concurrent use

Each household has a separate Worker and D1 database under the maintainer account. Multiple members may use one household simultaneously. D1 serializes queries per database; atomic writes and idempotency protect balances and retried actions. Cross-device refresh is eventual (after writes, tab activation and periodic polling), not live push. Shared account quotas still apply across households. The pilot is a functional check, not a high-load capacity test.

## Implementation order

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 1. Instance foundation | Registry, unique configuration, schema tracking and recoverable provisioning | A second instance cannot access the first family's records; no existing binding changes |
| 2. Parent setup | Secure claim, children/order, opening balances, catalog, monthly goal and review | Mobile Back/resume works; completion is exactly once; existing families bypass setup |
| 3. Migration | Workbook/CSV mapping, role selection, overlap review and preview | Balances match exactly and each retained activity appears once |
| 4. Release controls | Tags, pilot checks, manual selected/all rollout, target status and rollback | Two instances receive the chosen version while retaining different databases, passwords and settings |
| 5. Handoff | Short tour, sharing, parent editing and version notice | A parent sets up without developer tools; a child chooses a goal and completes an activity |

Finish release controls and password recovery before inviting a wider group. See [PASSWORD_RECOVERY.md](PASSWORD_RECOVERY.md) and [RELEASES.md](RELEASES.md) for the implemented recovery and release controls. Publishing workflow source does not activate managed rollout.

## Acceptance checks

- Unrelated visitors cannot claim/resume setup; expired/replayed tokens fail.
- Existing families skip onboarding after upgrades and no production data is reseeded.
- Arbitrary names/roles, participant order and default selection work.
- Four-character passwords work; children cannot update passwords or import data.
- Starting balances/imports do not inflate monthly progress; month boundaries and cancellation/redemption rules hold.
- Retried setup/import requests are exactly once, with no active partial family after failure.
- Two-instance tests prove releases cannot cross data, credentials or bindings.
- Development pushes cannot trigger release-to-all; partial failures are visible and retryable.
- Schema-compatible rollback preserves data; the app version of each family is inspectable.

## Platform references

- [Manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub deployments and concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [Worker configuration and bindings](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
