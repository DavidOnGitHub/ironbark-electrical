# Iron Spark

The marketing demo business app: **Ironbark Electrical**, a fictional small
trade contractor. It shows what the platform can do for a whole business -
clients, enquiries, quotes, jobs, invoices and automations - not just
workflows. Requirements and design live in the platform repo
(`PLAN-demo-business-requirements.md`, `PLAN-demo-app.md`).

Everything in it is fictional. It never shares data, accounts or credentials
with Joystep (its own database, its own Temporal namespace).

## Layout

```
app/                  Next.js routes: business pages + one-line re-exports of the console's
src/domain/           business modules, each with one public API (index.ts)
  clients/ requests/ pricing/ quotes/ jobs/ invoicing/ activity/ shared/
src/actions/          server actions (role check -> module API -> revalidate)
src/ui/               business UI pieces on top of the kit's components
src/access.ts         who may do what (Owner/Office/Technician/Bookkeeper)
prisma/schema.prisma  business schema, Postgres schema "iron-spark", own client + migrations
scripts/              seed and reset
test/                 unit + integration tests (own schema "iron-spark-test")
instrumentation.ts    configures the console: nav, role labels, policy
```

Module rules: a module is used only through its `index.ts`; modules never query
each other's tables; every change writes an `ActivityEvent` (the client
timeline) in the same transaction.

## Local setup

Needs the platform packages from GitHub Packages (`NODE_AUTH_TOKEN` and the
user-level `~/.npmrc` line - see the platform repo's `PUBLISHING.md`).

```bash
docker compose up -d            # from the platform repo: Postgres + Temporal
# once: create the database and the Temporal namespace
docker exec automation-postgres-1 psql -U postgres -c 'create database iron_spark'
docker exec automation-temporal-1 temporal --address "$(docker exec automation-temporal-1 hostname -i | cut -d' ' -f1):7233" operator namespace create --namespace iron-spark --retention 3d
cp .env.example .env.local && cp .env.example .env     # then fill in secrets
pnpm install                     # also generates both Prisma clients
pnpm db:migrate                  # platform tables
pnpm app:migrate                 # business tables
pnpm seed                        # demo data + demo accounts
pnpm dev                         # http://localhost:3000
pnpm worker                      # in another terminal (needed once workflows run)
```

`pnpm reset` returns the business data to the seed state. `pnpm test` runs the
suite (integration tests use the `iron-spark-test` schema).

## Demo accounts

Password for all: `IronSpark-demo-1` (local demo only - choose another for a
hosted demo).

| Account | Role |
|---|---|
| owner@ironbark.test | Owner (ADMIN - the platform requires an authenticator code on first sign-in) |
| office@ironbark.test | Office (EDITOR) |
| jordan@ironbark.test, mia@ironbark.test | Technician (OPERATOR) |
| books@ironbark.test | Bookkeeper (VIEWER) |

## Status

- **Phase 1 (foundation):** users and roles, clients and sites with a history
  timeline, the enquiry pipeline, seed data.
- **Phase 2 (quotes and jobs):** the price list; the quote builder (live GST and
  the 30% deposit rule over $1,500); the draft -> sent -> approved/declined/
  expired lifecycle; approving a quote creates the job and marks the enquiry Won;
  the job flow, week schedule with clash warnings, and the technician's own
  "My day" (own jobs only, never prices); notes and variations with office approval.
- **Phase 3a (invoicing):** invoices drafted from completed jobs (quote lines plus
  approved variations, deposit credited), reviewed and issued with 7-day terms,
  part and full payments, void and re-invoice, overdue status on the chasing
  cadence (day 1 / 7 / 14 / 30), deposits tracked against the job, the money
  position on the dashboard, and a CSV export for the bookkeeper.
- Next: Stripe test-mode payment links and the four automations (Phase 3b).

All money is integer cents; business time is Sydney time (`src/lib/tz.ts`).
Quotes are marked as sent by a person; emailing them arrives with the workflows.
