# Ironbark Electrical

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
src/steps/            the workflow steps (defs = what the builder shows, impl = what runs in the worker)
src/workflows/        the four automations as workflow definitions
src/automation/       starts them from quote sent / invoice issued / invoice paid
src/integrations/     Stripe (payment links, signed webhook)
src/actions/          server actions (role check -> module API -> revalidate)
src/ui/               business UI pieces on top of the kit's components
src/access.ts         who may do what (Owner/Office/Technician/Bookkeeper)
prisma/schema.prisma  business schema, Postgres schema "ironbark-electrical", own client + migrations
scripts/              seed and reset
test/                 unit + integration tests (own schema "ironbark-electrical-test")
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
docker exec automation-postgres-1 psql -U postgres -c 'create database ironbark_electrical'
docker exec automation-temporal-1 temporal --address "$(docker exec automation-temporal-1 hostname -i | cut -d' ' -f1):7233" operator namespace create --namespace ironbark-electrical --retention 3d
cp .env.example .env.local && cp .env.example .env     # then fill in secrets
pnpm install                     # also generates both Prisma clients
pnpm db:migrate                  # platform tables
pnpm app:migrate                 # business tables
pnpm seed                        # demo data + demo accounts
pnpm dev                         # http://localhost:3200 (set PORT to use another)
pnpm worker                      # in another terminal (needed once workflows run)
```

`pnpm reset` returns the business data to the seed state; `pnpm demo:reset` also publishes the
workflows, and `pnpm demo:check` says whether the demo is ready to show (see `WALKTHROUGH.md` for the
10-minute script). `pnpm test` runs the
suite (integration tests use the `ironbark-electrical-test` schema).

## Demo accounts

Password for all: `Ironbark-demo-1` (local demo only - choose another for a
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
- **Phase 3b (automations and payments):** four workflows built from our own steps -
  *Enquiry to reply* (AI sorts the inbox, logs the enquiry, acknowledges at once, a
  person approves the reply, emergencies alert the owner first), *Quote and chase*
  (email, remind after a day, owner calls after three more - to an address that is not on the
  allowlist the office reads and approves each email first, and approving sends it), *Invoice and payment chase*
  (email with a card pay link, then day 1 / 7 / 14 / 30 overdue), *Review request*
  (a day after payment, one reminder, unhappy replies to the owner). Stripe test-mode
  pay links and a signed webhook that records the payment. Every automated email except the
  acknowledgement waits for a person or is a fixed, reviewed wording; the acknowledgement only goes to
  allowlisted senders, while a reply a person approves may go to anyone; everything an
  automation does lands on the client's history.

## Quote bundles and suggested lines

Setup > Price list has **Bundles**: a named set of price-list items with quantities (for example the switchboard
upgrade package), added to a quote in one click at today's prices - a bundle has no price of its own. In the quote
editor, **Suggest lines** reads the enquiry (or any description) and proposes bundles and items with quantities;
the office ticks what is right before anything is added. It matches by keyword against the price list. With
`ANTHROPIC_API_KEY` set it asks the AI instead, which may only choose price-list entries and quantities (never a
price), and falls back to keywords if the call fails. Matching lives in `src/domain/quotes/suggest.ts`.

## Email templates

Every email the automations send comes from a template (Setup > Email templates, Owner and Office): a subject and a
message in light markup (blank line = paragraph, `- ` bullets, `**bold**`, `[text](url)`, a link on its own line
becomes a button) with `{{variables}}`. It is sent as a branded HTML email with a plain-text twin. Editing shows a
live preview. The workflow builder's email step (*Send templated email*) has a dropdown of the templates; map each
variable it uses (a missing one stops the email with a clear message, also in a test run). Defaults are created by
the seed; a template a workflow uses cannot be deleted. `src/domain/emailTemplates/` holds the renderer and the
defaults, `src/integrations/gmailSend.ts` the Gmail send.

## Automations

```bash
pnpm workflows:seed              # the four workflows as drafts (re-run after connecting Gmail)
pnpm worker                      # the worker that runs them
pnpm workflows:try quoteChase    # walk one through Temporal in TEST mode (mock email, 5 s waits)
pnpm workflows:try enquiry emergency   # enquiry | invoiceChase | reviewRequest; variants: emergency, noise, reject
pnpm workflows:seed --publish    # publish them: they then start for real on business events
```

A published workflow starts by itself when a quote is marked sent, an invoice is issued, or an
invoice is paid (`AUTOMATIONS=off` stops that). Drafts never run for real. Real emails need a
connected Gmail account (Connected apps, as the Owner); until then an email step falls back to a
task for a person. Test runs never contact anyone or change business data.

Setup you need once: connect a demo Google account in the console (the redirect URI
`<app>/connectors/oauth/callback` - locally `http://localhost:3200/connectors/oauth/callback` - must be on the Google OAuth client), and add Stripe test keys to
the environment (see `.env.example`).

All money is integer cents; business time is Sydney time (`src/lib/tz.ts`).
Quotes are marked as sent by a person; emailing them arrives with the workflows.
