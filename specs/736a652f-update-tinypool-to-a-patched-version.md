# Update tinypool to a patched version (GHSA-5gmw-xhrv-c9v3)

**Type:** feature

Maintenance only, no behaviour change. The osv scan flags the transitive dev dependency tinypool@1.1.1 (pulled in by vitest@3.2.7) as critical: prototype pollution in worker options can lead to remote code execution. Move tinypool to the smallest release that the advisory lists as fixed, and change nothing else. The app does not use tinypool at runtime. It only runs inside the vitest test runner.

## Acceptance criteria

- **AC-1** Given the updated pnpm-lock.yaml, when it is inspected, then no tinypool entry at 1.1.1 (or any version listed as affected by GHSA-5gmw-xhrv-c9v3) remains, and the single resolved tinypool version is the smallest fixed release.
- **AC-2** Given the change, when the diff is reviewed, then the only changes are to the tinypool resolution (a lockfile refresh of tinypool, or if the fix is outside vitest's declared range, one entry in the `overrides` block of pnpm-workspace.yaml plus the matching lockfile update), with no other package version changes.
- **AC-3** Given the change, when the diff is reviewed, then no files under app/, src/, prisma/, test/ or docs/business/ are modified and application behaviour is unchanged.
- **AC-4** Given the updated lockfile, when the CI verify job runs (install, db:migrate, lint, typecheck, test, build), then every step passes with no test edited, apart from a purely mechanical test change if the new version strictly requires one.
- **AC-5** Given the updated lockfile, when the osv scan is re-run, then GHSA-5gmw-xhrv-c9v3 is no longer reported for tinypool.

## Edge cases

- Assumption: the fixed tinypool version could not be looked up here (no network, and tinypool is not installed). The builder must take it from the GHSA-5gmw-xhrv-c9v3 advisory and use the smallest fixed version.
- If the fixed version is inside vitest@3.2.7's range (^1.1.1), prefer a lockfile-only update (`pnpm update tinypool`). Otherwise add an override such as `tinypool@<FIXED: ^FIXED` in pnpm-workspace.yaml, with a comment like the existing ones.
- The repo has `minimumReleaseAgeExclude`. If the fixed release is too new for the release-age gate, add only that exact tinypool version to the exclusion list.
- This touches the 'Dependencies' protected path. The request explicitly asks for it and a person reviews the PR.
- Nothing can be run in the sandbox (no network, no Postgres), so only the GitHub CI verify job counts as verification.

## Out of scope

- Upgrading vitest or any other package, including a major vitest upgrade, unless that is the only way to reach a fixed tinypool
- Any other scanner findings
- Changes to application code, tests, business rules, CI or the database
- Removing existing overrides

## Affected areas

- pnpm-lock.yaml (tinypool entries at lines ~4118, ~8687, and the vitest@3.2.7 dependency list ~8905)
- pnpm-workspace.yaml (only if an override is needed; existing `overrides` block with comments is the convention)
