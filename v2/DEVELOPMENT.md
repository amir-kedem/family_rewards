# Development across computers, desktop and phone

GitHub is the shared source of code. Local testing, the hosted pilot and the live family app each keep a separate database.

| Branch | Purpose | Deployment |
| --- | --- | --- |
| `develop` | Shared development, including local testing tools | No automatic production deployment |
| `pilot` | Changes selected for online testing | Connect the existing pilot Worker to this branch as described below |
| `family-rewards-v2` | Approved production code | Existing Cloudflare Workers Builds deployment |

`main` is still the legacy/default branch. When using a desktop or phone coding tool, explicitly select `develop` as the starting branch. If the tool creates a task branch, open its pull request against `develop`.

## Daily work

Before starting on this computer, finish or commit any current edits, then run from the repository root:

```powershell
git switch develop
git pull --ff-only
```

Make changes and test locally using the [local setup instructions](README.md#local-testing-with-sample-data). Commit the intended source files and push `develop` so other devices can access them. Pull again before continuing here after work from another device. If Git reports diverged branches, reconcile the changes before continuing; do not force-push shared branches.

The local SQLite database, private workbook exports and credentials stay ignored. They are not synchronized with GitHub. New computers can use `npm run local:setup` for fictional samples; private family data requires a separate local import.

## Test and release

1. Open a pull request with base `pilot` and compare `develop`. Review the diff and merge when ready for online testing.
2. Test the deployed pilot, including family/parent login, point actions, rewards and history. This requires the pilot's branch connection below to be configured first.
3. Open a pull request with base `family-rewards-v2` and compare `pilot`. Merge only after pilot testing passes. This merge triggers the existing production deployment.

Keep promotion merges consistent so tested code flows from `develop` through `pilot` to production. If a hotfix lands directly on production, merge it back into both `pilot` and `develop` before further development.

At branch creation, `pilot` points to the current production source. The local testing changes are committed only to `develop`; creating the branches does not itself connect a Cloudflare deployment.

## Connect the existing hosted pilot

In Cloudflare, open the existing **family-rewards-pilot** Worker and its Git/Build configuration:

- Repository: `amir-kedem/family_rewards`
- Production branch for this pilot Worker: `pilot`
- Root directory: `v2`
- Build command: `npm ci && npm run build`
- Deploy command: `npx wrangler deploy --config wrangler.pilot.jsonc`

Use the pilot config so the deployment targets `family-rewards-pilot` and its existing pilot database. Keep its existing runtime secrets and database binding. Connect the pilot Worker only; the live family's Worker must continue tracking `family-rewards-v2`. Review any preview/non-production build settings so pushes to `develop` do not deploy over either existing Worker.

The normal `npm run deploy` command targets production through `wrangler.jsonc`; use the branch promotion workflow for releases. No Cloudflare resources, migrations or onboarding initialization need to be recreated for this branch setup.
