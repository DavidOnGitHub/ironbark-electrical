# Demo walkthrough - "A Monday morning at Ironbark Electrical" (10 minutes)

For a prospect who runs a small business on email, spreadsheets and a patchwork of apps. The point to land:
**"your business, your process"** - the same platform that runs this electrician can run theirs.

Say "this is a fictional electrician" once, early. After that, tell the story as if it were their business.

## Before you start (5 minutes, every time)

```bash
cd ~/dev/ironbark-electrical
docker compose up -d            # from the platform repo, if Postgres/Temporal are not running
pnpm demo:reset                 # clean seed data, workflows re-published
pnpm dev                        # terminal 1: http://localhost:3200
pnpm worker                     # terminal 2: runs the automations
stripe listen --forward-to localhost:3200/api/stripe/webhook   # terminal 3: only for the payment moment
pnpm demo:check                 # PASS on every line you need
```

`pnpm demo:check` tells you what is missing and how to fix it. Needed for the full real-integration version:
Gmail connected (Owner > Connected apps), Stripe test keys in `.env`, and the Stripe webhook secret that
`stripe listen` prints. Without Gmail the emails become tasks for a person; without Stripe there is no pay link.
Everything else still works, so the demo degrades gracefully - say so if it happens.

Sign in as **Office (`office@ironbark.test`, password `Ironbark-demo-1`)** for the main story. Keep a second
window signed in as **a technician on a phone-sized window** (`jordan@ironbark.test`).
The Owner account asks for an authenticator code the first time (platform rule); skip it unless you want to
show that off.

## The story

| Min | Role | What you do | What you say |
|---|---|---|---|
| 0:00 | Office | Open the **Dashboard**. | "Sam runs a small electrical business. This is what needs attention at 7am: new enquiries, open quotes, money owed, and who is on the tools today." Point at the yellow-edged tile and the red overdue amount. |
| 1:00 | - | Send an email to the demo inbox alias (`you+ironbark@gmail.com`), for example "Hi, can you quote on six downlights in our lounge room?" from any other address. A sender not on the allowlist skips the automatic acknowledgement but still gets a person-approved reply; one on the allowlist also gets the acknowledgement at once. | "A customer emails the business, like they always do." |
| 1:30 | Office | Open **Runs** (Automation section). Open the live *Enquiry to reply* run. | "An AI reads it, decides it is a real enquiry, logs it, and has the acknowledgement ready - but it does not send anything it should not. A person approves the reply." |
| 2:30 | Office | Go to **Tasks** (Automation section), open *Office approves the reply*, **Approve**. Check the demo inbox for the email. | "One click. The customer has an answer in minutes, and it is on their history. Emergencies would have phoned the owner first." |
| 3:30 | Office | **Requests**: open *Quote to rewire 1960s house* > **Create a client from this enquiry** > **Create a quote**. Add two lines from the price list (for example Electrician + Switchboard upgrade). **Save lines**. | "Prices come from the price list. GST and the deposit rule over $1,500 are automatic. No spreadsheet." |
| 5:00 | Office | **Mark as sent**, then **Customer approved**. | "Sending the quote starts a follow-up automation (reminder after a day, owner calls after three more). Approving it creates the job and marks the enquiry won." You land on the new job. |
| 5:45 | Office | On the job: pick **Jordan Lee**, tomorrow's default time, **Schedule**. The clash warning appears; choose **Mia Chen** (or **Book anyway**). | "It warns about double-booking before it happens." |
| 6:30 | Technician (phone window) | **My day**: **Start / resume**, open **Add a note or variation**, add a note, **Mark complete**. | "The technician gets a phone-friendly list: Call, Directions, access notes - and never sees prices. A variation, like extra work, flows to the invoice after the office approves it." |
| 7:30 | Office | Job page > **Create invoice**, review, **Issue invoice**. Show the **Payment link**. Open it in a new tab and pay with the Stripe test card `4242 4242 4242 4242`, any future date, any CVC. | "Deposit credited, GST right, a card link on the invoice. Overdue chasing starts by itself: day 1, 7, 14, 30." |
| 8:30 | Office | The invoice flips to **Paid** by itself (Stripe's webhook). Open the client's page to show the **timeline**. | "Payment recorded without anyone typing. Everything the automations did is on the client's history, so nobody has to ask what happened." A review request goes out a day later. |
| 9:00 | Office | **Dashboard**, then **Reports**. | "The owner sees conversion, how fast customers decide, how long jobs take to invoice and get paid, and what each technician brought in. Bookkeepers get a CSV." |
| 9:30 | Office | **Works for...** - open the industry that matches the prospect. | "This is an electrician. Here is what each part becomes for a clinic, a cleaner, an agency, a wholesaler - and the first automation we would build for you." |

Close with the question: **"Which of these steps is the one that costs you the most time today?"** The answer is
the first automation to build.

## Optional closer: "build a workflow from a sentence"

Workflows (Automation section) > the AI assistant. Ask for something in the prospect's words (for example "when a client
pays an invoice, send them a thank you and ask for a review"). Needs the AI assistant configured; **not yet
rehearsed here**, so try it before relying on it.

## Real vs. simulated

| Real | Simulated or limited |
|---|---|
| Gmail: inbound enquiry and outbound email (only to addresses on `EMAIL_ALLOWLIST`) | The AI triage in test runs uses a built-in mock |
| Stripe test-mode card payment and webhook | Test mode only: no real money |
| Temporal workflows with real waits (production mode) | Test mode caps waits at 5 seconds |
| Users, roles, data, reports | Fictional business and data |

Fully automatic email (acknowledgements, quote and invoice chases, review requests) only goes to addresses on `EMAIL_ALLOWLIST`; with no allowlist none is sent and the step hands the job to a person. A reply a person has read and approved can go to any sender.

## If something goes wrong

| Symptom | Fix |
|---|---|
| No email arrived | `pnpm demo:check`. Is the worker running? Is the recipient on `EMAIL_ALLOWLIST`? Is Gmail connected? |
| The enquiry did not start a run | The mail must be sent **to** the `+ironbark` alias, from outside the connected account. |
| Invoice has no payment link | Stripe keys missing in `.env`; restart `pnpm dev`. |
| Invoice did not flip to Paid | `stripe listen` is not running, or its `whsec_...` is not in `STRIPE_WEBHOOK_SECRET`. |
| Page says something went wrong | Reload; if it repeats, check the `pnpm dev` terminal. |
| Everything is a mess | `pnpm demo:reset` and start again. |

## Rehearsal log

The human path (enquiry to client to quote to approval to job to schedule to technician to invoice to
payment to dashboard and reports) was driven end to end in a browser against a clean seed with automations
off: 21 checks, no errors. The four automations were walked in test mode through Temporal.
The real Gmail, Stripe card and AI-assistant moments need a live rehearsal by you with your accounts.
