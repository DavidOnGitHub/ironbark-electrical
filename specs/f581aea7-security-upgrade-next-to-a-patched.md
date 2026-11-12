# Security: upgrade next to a patched version (GHSA-2464-fhr4-w9xw)

**Type:** feature

Automated maintenance for finding IT-1006. The osv scan reports a critical vulnerability (GHSA-2464-fhr4-w9xw, unauthenticated remote code execution in the Next.js Image Optimization API with SVG files) in next@16.3.7. Update next to the smallest patched release that the advisory lists as fixed, staying in the 16.3.x line if a fix exists there. Behaviour does not change for any user, role, business rule or screen. The app does not configure `images` in next.config, so only the dependency version changes.

## Acceptance criteria

- **AC-1** Given the advisory GHSA-2464-fhr4-w9xw, when the update is done, then `next` in package.json and pnpm-lock.yaml is the smallest published version the advisory lists as patched (a patch or minor bump from 16.3.7, no major jump), and no `next@16.3.7` entry remains in pnpm-lock.yaml.
- **AC-2** Given `eslint-config-next` and `@next/eslint-plugin-next` are pinned to the same version as next (16.3.7), when next is bumped, then they are bumped to the matching version only if one is published and needed to keep versions aligned; no other dependency is changed except those pnpm must re-resolve because of next (for example @next/* SWC binaries and the next peer entries in the lockfile).
- **AC-3** Given pnpm-workspace.yaml lists `minimumReleaseAgeExclude` entries for next@16.3.7 and its @next/* packages, when the version is bumped, then the exclusion entries are updated to the new version so install is not blocked by the release-age check; no other settings or overrides in that file change.
- **AC-4** Given the update is applied, when `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` run (the GitHub CI verify job), then all pass with no edits to application code, business rules (docs/business) or tests, except a purely mechanical test change if the new version strictly requires it.
- **AC-5** Given the updated lockfile, when osv is run again on pnpm-lock.yaml, then GHSA-2464-fhr4-w9xw is no longer reported for next, and no new critical or high findings are introduced by the change.
- **AC-6** Given the update, when users use the app (clients, quotes, jobs, invoices, public accept/book/pay pages, API routes), then behaviour is identical to before.

## Edge cases

- The sandbox has no network and cannot run installs, so the exact fixed version must be taken from the advisory and the lockfile regenerated where the private registry is reachable; CI is the verification.
- If the advisory's fix is only in a newer minor line than 16.3.x, use the lowest fixed version and note it in the pull request.
- @kabosh-digital/m-street-kit and next-auth peer-depend on next; the new version must satisfy those peer ranges, otherwise note it in the pull request rather than upgrading the kit.

## Out of scope

- Any code, UI, schema or business-rule change
- Changing next.config image settings or adding workarounds (the app does not configure images)
- Upgrading unrelated dependencies, the @kabosh-digital kit, React, Prisma or Node
- Changing CI, workflows, deployment or secrets
- Assumption: the exact fixed version number is not known from the repo; it is decided from the advisory when making the change

## Affected areas

- package.json (next, and eslint-config-next if aligned)
- pnpm-lock.yaml
- pnpm-workspace.yaml (minimumReleaseAgeExclude entries for next and @next/*)
