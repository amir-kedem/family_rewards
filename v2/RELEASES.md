# Managed releases

Status: implemented and locally tested, **not activated**. The existing family and pilot still use branch-triggered Workers Builds. This workflow never runs on a push. A successful local test is not a live Cloudflare rollout test.

The maintainer chooses a reviewed version tag and its full commit SHA, then plans or releases to the pilot, selected household IDs, or all managed households. Parents do not need GitHub or Cloudflare accounts. Every household retains its own Worker, URL, database, passwords and settings.

## Before activation

1. Publish `.github/workflows/family-rewards-managed-release.yml` and its three imported helper modules (`managed-release.mjs`, `release-controls.mjs`, `instance-config.mjs`) on the default branch. This is orchestration only; it does not replace the legacy app on `main`. GitHub requires a manual workflow to be present on the default branch. The job also refuses orchestration from another branch.
2. Create a GitHub environment named `family-rewards-managed`. Configure required reviewers and default-branch restrictions where the repository plan supports them. Add protected environment secrets: `FAMILY_REWARDS_INSTANCES`, `CLOUDFLARE_ACCOUNT_ID`, and a least-privilege `CLOUDFLARE_API_TOKEN` able to read Worker settings/deployments and deploy only the intended account's Workers/static assets. Do not put passwords or invitation tokens here.
3. Keep `FAMILY_REWARDS_MANAGED_RELEASES_ENABLED` unset. Prepare the private registry below and run a **plan**. Planning requires the registry but does not require Cloudflare credentials or make Cloudflare requests.
4. Reconcile each enrolled instance's identity and data schema. An existing legacy family without matching `INSTANCE_ID`/`INSTANCE_ORIGIN` and registered database identity is deliberately rejected. Do not add those pins alone: prepare a separate reviewed identity registration. Manually initialized D1 schemas also need migration tracking reconciled before any later schema automation. This workflow applies no SQL.
5. Disconnect or disable branch-triggered Workers Builds for each enrolled Worker. Turn off the old opt-in Actions deployment path (`FAMILY_REWARDS_V2_ENABLED`) too. Confirm there is one deployment owner, then set that instance's registry `buildsDisconnected` to `true`. A registry flag is an operator attestation, not automatic detection of dashboard settings.
6. Set protected environment variable `FAMILY_REWARDS_MANAGED_RELEASES_ENABLED=true` only after cutover. Start with an **apply to pilot**. Check the app and normal point/parent flows yourself, then choose selected/all. Do not enable billing upgrades automatically.

The registry is JSON in the protected `FAMILY_REWARDS_INSTANCES` secret. Use opaque IDs and actual unique resource identifiers. This example is illustrative and cannot deploy until real identifiers are supplied:

```json
{
  "schemaVersion": 1,
  "instances": [
    {
      "id": "family-pilot",
      "workerName": "family-rewards-pilot",
      "databaseName": "family-rewards-pilot-db",
      "databaseId": "11111111-1111-4111-8111-111111111111",
      "origin": "https://family-rewards-pilot.YOUR_SUBDOMAIN.workers.dev",
      "managed": true,
      "schemaVersion": 2,
      "channel": "pilot",
      "buildsDisconnected": false
    }
  ]
}
```

Add production records with `channel: "production"`. Exactly one pilot is required. Duplicate IDs, databases, resource names or origins are rejected across the entire registry. Only registered, completed instances qualify; this workflow does not provision a new family or finish onboarding.

## Choose and release a version

Create a reviewed immutable semver tag such as `v2.1.0`, protect release tags against updates/deletion, and record its full commit SHA. Both inputs are mandatory. Deployment checks out that SHA and verifies the tag resolves to it; a moved or mistyped tag fails before deployment. Release source must include the current application, package lock, tests and ordinary `wrangler.jsonc` used only for a local dry-run bundle.

In GitHub Actions, run **Family Rewards managed release** from the default branch. Enter:

- `release_tag`: reviewed version tag.
- `release_sha`: full 40-character commit SHA for the tag.
- `scope`: `pilot`, `selected`, or `all`.
- `instance_ids`: comma-separated opaque production IDs when selecting targets.
- `apply`: leave off for a plan; turn on to deploy after reviewing the plan and cutover.

No user input is interpolated into shell code. Tag and IDs reject shell/path syntax. Credentials are provided only to the release step, after tests and build; the selected release is trusted maintainer-reviewed code, not arbitrary pull request code.

Every run tests the selected source, builds frontend assets once and bundles the Worker once locally with `--dry-run`. Deployment uploads that same prebuilt Worker and frontend assets with generated target-specific bindings. It does not rerun an application build for each family. The result records the Worker bundle SHA-256, deterministic frontend-assets digest and selected source SHA. Keep the pinned lockfile and review release code before giving it deployment credentials.

Apply preflights every destination before changing any target: existing D1 binding and identity pins must match the private registry; `/api/setup` must return `required:false`; active Worker versions must be retrievable. Targets deploy sequentially, pilot first. A failed pilot or later target stops promotion and leaves remaining targets pending. One workflow concurrency group prevents overlapping managed fleet releases; it cannot prevent unrelated dashboards, CLI sessions or old workflows from deploying, which is why cutover matters.

## Results, retries and rollback

The `family-rewards-release-results` Actions artifact records the chosen tag/SHA, Worker bundle and frontend-assets hashes, opaque target IDs, status, and before/after active Worker version IDs. It contains no registry credentials, family names or passwords. Source/build or input failures can happen before a result file exists; inspect the failed step too. Plan results list target IDs and cutover readiness only. Cloudflare command output is withheld from public logs because it can contain private target details; use Cloudflare's dashboard for deeper investigation after a deploy failure.

Post-deploy checks verify the binding/identity again and confirm the completed instance answers `/api/setup`. A ready result also requires exactly one newly active Worker version, different from the preflight versions; unchanged/partial deployment cannot be reported as ready. This is a runtime smoke check, not an automated test of family credentials or every product action. Maintainer testing on the pilot remains required before selecting a broader rollout.

If a production target fails, inspect the result and actual active version: deployment might have succeeded before a health check failed. Retry only failed/unreleased IDs using `selected`; the pilot is checked/deployed first again. Successful households remain on the released version. No database rollback is attempted automatically.

For code rollback, select an earlier approved tag and its exact SHA through the same workflow. That version must be compatible with the current data schema. This workflow never restores a database, runs migrations, initializes invitations, reseeds catalogs or clears sessions/passwords. Database recovery is separate and requires an explicit reviewed procedure and recovery point.

## References

- [GitHub manual workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub deployment environments and concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [Cloudflare Worker settings and deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
