# Provision a private family instance

The code includes a four-step first-run wizard for newly provisioned instances: children/order/opening balances, optional activities/prizes, family name/monthly goal, and final review/family password. A private invitation first establishes the parent password and setup ownership. The current family's installation bypasses this flow and does not need a migration for this release.

These tools **prepare files locally**. They do not create Cloudflare resources, upload data, change billing or deploy automatically. Controlled release-to-all remains separate implementation work.

## Requirements

- Node 24+, the repository checked out on `family-rewards-v2`, and `npm ci` in `v2/`.
- The intended Cloudflare account, with capacity for another Worker/D1 database.
- A new, empty D1 database with a unique name. Never reuse the current family's database.
- The expected final HTTPS origin, unique Worker name and database UUID.

## 1. Create a private registry

Copy `scripts/instances.example.json` to `.private/instances.json` and replace all placeholders. Keep it private and out of GitHub. Each record has an opaque instance ID, Worker name, database name/UUID, and exact HTTPS origin, without a trailing slash or path. Resource names, origins and database UUIDs must be unique across the registry.

If `.private/` does not exist yet, create it first. It is ignored by Git. Do not put parent/family passwords or Cloudflare API tokens in the registry.

## 2. Generate instance files

From `v2/`:

```sh
node scripts/prepare-instance.mjs --registry .private/instances.json --instance family-example
```

This validates the entire registry and writes `.private/family-example/` with restricted permissions:

- `wrangler.jsonc`: target-specific Worker/database configuration and identity pins.
- `invitation.sql`: guarded initialization containing an invitation verifier, not the raw token.
- `setup-link.txt`: the private invitation URL, expiring after 48 hours.
- `instance.json`: the validated target record.

No invitation token is printed to the terminal. Existing output is not overwritten. Do not commit or share these files publicly, and do not paste the setup link into a support chat.

## 3. Initialize the new database and deploy

Review the generated target details against Cloudflare first. Then, from `v2/`, authenticate to the intended account and run:

```sh
npx wrangler d1 migrations apply family-rewards-example-db --remote --config .private/family-example/wrangler.jsonc
npx wrangler d1 execute family-rewards-example-db --remote --config .private/family-example/wrangler.jsonc --file .private/family-example/invitation.sql
npm run build
npx wrangler deploy --config .private/family-example/wrangler.jsonc
```

Replace example names with the generated instance names/paths. Use the same generated config for migration, invitation initialization and deployment. Wrangler tracks the applied migrations. Initialization refuses nonempty datasets or an already initialized identity; stop on an error instead of rerunning blindly. This is not an upgrade procedure for the existing family.

API requests for a provisioned instance require its stored identity, configured identity and request origin to match. A wrong database binding, wrong origin or missing identity pins fails closed. Preview URLs are disabled for these instance configs; use a separately provisioned test instance for previewing new versions.

## 4. Parent setup

Deliver the invitation privately to the parent. The token is in the URL fragment, exchanged through a POST and removed from the address bar. Claiming consumes it; the setup owner receives a Secure/HttpOnly/SameSite cookie and chooses a parent password with a four-character minimum.

Drafts save when moving between steps. A setup session lasts 30 minutes; the parent can resume with the chosen parent password. Final completion is transactional and retry-safe. Opening balances are not inserted as earned history. Family and parent password verifiers are saved in the private database; this path does not require bootstrap password secrets. The two passwords must differ.

On completion the current parent is signed in. Share only the family URL and family password with children. Completed instances do not show onboarding again.

## Expired invitations and recovery

Before claim, a maintainer can prepare a replacement invitation:

```sh
node scripts/prepare-instance.mjs --registry .private/instances.json --instance family-example --renew-invitation
```

This creates a new private output directory. Execute its `invitation.sql` with the registered instance's config, verify the operation succeeded, and privately send the new setup link. Renewal replaces the old token and only works for an empty, matching, still-pending instance. It cannot reclaim a claimed/completed family or reset its passwords.

After claim, the normal recovery path is resuming with the parent password. Lost parent passwords need a separate verified-owner maintenance procedure; there is no public password-reset bypass or automatic data deletion.

## Verification before inviting another family

Provision an isolated test instance and complete setup on desktop and mobile. Verify identity mismatch rejection, session expiry/resume, child order, starting balances, monthly goal, tasks, parent controls and family login. The local API suite covers invalid/expired/replayed invitations, cross-origin requests, byte limits, rate limits, private drafts, stale writes, concurrent completion and full rollback on failure. Local tests and sample-screen previews do not replace this second-instance Cloudflare check.

Maintain capacity within the account's plan. Keep instance configuration and recovery records private. Regular code updates must reuse the same target-specific bindings and preserve family data; do not rerun invitation initialization, onboarding or seed data on upgrades.
