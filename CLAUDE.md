@AGENTS.md

# Ironbark Electrical - codebase map

A Next.js 16 / React 19 / TypeScript app for a fictional electrical contractor, built on a private platform kit (`@kabosh-digital/*`, from GitHub Packages) plus its own business domain. Postgres via Prisma, workflows on Temporal. `AGENTS.md` warns that this Next.js version has breaking changes: read `node_modules/next/dist/docs/` before writing Next code.

Business rules live in `docs/business/*.md` (ids `BR-CLI`, `BR-REQ`, `BR-PRC`, `BR-QUO`, `BR-JOB`, `BR-SCH`, `BR-INV`, `BR-PAY`, `BR-RPT`, `BR-ACC`, `BR-AUT`, `BR-EML`). Keep them in step with the code.

## Layout

- `app/` Next.js routes (clients, requests, quotes, jobs, invoices, schedule, my-day, pricing, reports, email-templates, public `accept/`, `book/`, `pay/`, `api/`). Many are one-line re-exports of the platform console.
- `src/domain/<module>/index.ts` business modules: clients, requests, pricing, quotes, jobs, invoicing, siteVisits, booking, availability, approvals, emailTemplates, reports, activity, shared. Pure rules sit in `calc.ts`, `status.ts`, `rules.ts`, `normalize.ts` beside each `index.ts`.
- `src/actions/` server actions: role check, then module API, then revalidate.
- `src/access.ts` who may do what; `src/guard.ts` helpers.
- `src/steps/` workflow steps (`defs` = what the builder shows, `impl` = what the worker runs); `src/workflows/` the automations; `src/automation/` starts them from business events.
- `src/integrations/` Stripe (payment links, signed webhook), Gmail send, recipient allowlist.
- `src/lib/` `money.ts`, `tz.ts` (Sydney time), `bank.ts`; `src/ui/` UI pieces; `src/db/app.ts` the business Prisma client.
- `prisma/schema.prisma` business schema (Postgres schema `ironbark-electrical`) with migrations; the platform schema comes from `@kabosh-digital/workflow-schema`.
- `scripts/` seed, reset, workflow seeding; `instrumentation.ts` configures nav, role labels, policy; `worker.ts` is the Temporal worker.

## Commands (pnpm 11, Node >= 22)

- Install: `pnpm install` (needs `NODE_AUTH_TOKEN` or a user-level `~/.npmrc` token with read access to GitHub Packages for the `@kabosh-digital` scope; also runs `prisma generate` for both schemas).
- Test: `pnpm test` (vitest, files run one at a time). Needs a reachable Postgres: `test/globalSetup.ts` runs migrations on schema `ironbark-electrical-test` using `APP_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/ironbark_electrical`). Platform tables need `pnpm db:migrate` first (CI does this).
- Lint `pnpm lint`; typecheck `pnpm typecheck`; build `pnpm build`. CI runs migrate, lint, typecheck, test, build.
- Pure-rule tests (`rules`, `invoicing.rules`, `status`, `normalize`, `availability`, `allowlist`) need no data but still pass through the global DB setup.

### How AI changes are verified

The AI Builder sandbox has no network and no commands configured in `.ai-builder/config.yaml` (`commands` is empty). It cannot install dependencies (the private `@kabosh-digital/*` packages need a GitHub Packages token) or run the tests (they need Postgres), so nothing runs in the sandbox. The check for AI changes is the GitHub CI `verify` job (`.github/workflows/ci.yml`), which runs install, `db:migrate`, lint, typecheck, test and build on every pull request into `main` and `staging`. Do not report a change as tested until that job is green. When changing a rule, update the matching rule in `docs/business/` and add or adjust a test in `test/`.

## Conventions

- Money is integer cents everywhere, line amounts ex GST; convert only at the edges with `src/lib/money.ts`. Business time is Sydney time via `src/lib/tz.ts`.
- A module is used only through its `index.ts`; modules never query each other's tables.
- Every change writes an `ActivityEvent` (client timeline) in the same transaction (`recordActivity`).
- Validation uses zod schemas in the module; status flows are tables in `status.ts` and are enforced in the module, never only in the UI. Role checks happen in actions and pages via `Access` lists.
- Derived statuses (quote EXPIRED, invoice OVERDUE) are computed on read, not stored.
- Never let an automation failure undo a business action; automations email only allowlisted recipients (deny by default).
- Tests live in `test/*.test.ts`; add a test beside the rule you change. Schema changes need a Prisma migration in `prisma/migrations`.
- Do not edit `AGENTS.md` block markers; `next dev` regenerates them.
