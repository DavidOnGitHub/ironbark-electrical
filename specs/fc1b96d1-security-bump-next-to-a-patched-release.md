# Security: bump next to a patched release (GHSA-673q-mjm6-r5xr)

**Type:** feature

Automated maintenance. The osv scan flags next@16.3.7 (critical, GHSA-673q-mjm6-r5xr, unauthenticated RCE in `use cache` functions returning typed arrays). Raise `next` to the smallest patched release listed in the advisory, within the 16.3.x line if one exists. Raise `eslint-config-next` and `@next/eslint-plugin-next` only if they must match next. App behaviour does not change: no code, schema, business-rule or UI changes, and no new user stories.

## Acceptance criteria

- **AC-1** Given the repo pins next 16.3.7, when the update is done, then package.json `next` and the resolved `next` entry in pnpm-lock.yaml are the smallest release that the advisory GHSA-673q-mjm6-r5xr lists as patched, and no resolved `next@16.3.7` remains in pnpm-lock.yaml.
- **AC-2** Given the platform kit (`@kabosh-digital/m-street-kit`) and `next-auth` take `next` as a peer dependency, when the lockfile is regenerated, then those peer references resolve to the patched next and no other unrelated dependency versions change except the `@next/*` packages that next itself requires.
- **AC-3** Given `eslint-config-next` and `@next/eslint-plugin-next` are pinned to 16.3.7 alongside next, when next is bumped, then they are bumped to the same version only if needed to keep versions aligned; otherwise they are left as is.
- **AC-4** Given pnpm-workspace.yaml lists next 16.3.7 packages under `minimumReleaseAgeExclude`, when the new version is younger than the minimum release age, then the matching entries for the new version (next and its `@next/*` packages) are added or updated so install succeeds; no other settings in that file change.
- **AC-5** Given the update is applied, when the GitHub CI `verify` job runs (install, db:migrate, lint, typecheck, test, build), then every step passes with no edits to tests, except a mechanical change a new version strictly requires.
- **AC-6** Given the repo does not use `use cache` or `cacheComponents` anywhere, when the update is complete, then no application source, business doc, Prisma schema or migration file is modified.
- **AC-7** Given the finding is rescanned with osv after the change, then GHSA-673q-mjm6-r5xr is no longer reported for next, and no new critical or high findings appear from this change.

## Edge cases

- The sandbox has no network, so the exact patched version must be taken from the advisory and checked against the registry when the change is made. If no patched 16.3.x release exists, use the smallest patched release in the next line, and note this in the pull request.
- If the new release is younger than the pnpm minimum release age, the install fails unless pnpm-workspace.yaml is updated (AC-4).
- If the kit's peer range for next does not accept the patched version, stop and report it in the pull request rather than force an override.

## Out of scope

- Any behaviour, UI, business-rule, schema or migration change.
- Enabling or using `use cache` / cacheComponents (the code does not use them).
- Updating other dependencies, including `@kabosh-digital/*` packages, React, Prisma or Temporal.
- Changing the existing `overrides` entries or CI configuration.
- Running tests locally: the sandbox has no network and no Postgres, so the CI `verify` job is the check. A person reviews the pull request.

## Affected areas

- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml (minimumReleaseAgeExclude entries only, if needed)
