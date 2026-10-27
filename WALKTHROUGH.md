# Demo walkthrough - "A Monday morning at Ironbark Electrical" (about 11 minutes)

For a prospect who runs a small business on email, spreadsheets and a patchwork of apps. The point to land:
**"your business, your process"** - the same platform that runs this electrician can run theirs.

Say "this is a fictional electrician" once, early. After that, tell the story as if it were their business.

The thread that runs through it: **the system does the work, a person approves what the customer sees.** Four times the
office gets a task, reads exactly what will happen, can edit it, and approves. Everything between is automatic.

## Before you start (5 minutes)

```bash
cd ~/dev/ironbark-electrical
pnpm install                    # once after pulling (adds the PDF library)
pnpm app:migrate                # once after pulling (new tables and columns)
docker compose up -d            # from the platform repo, if Postgres/Temporal are not running
# pnpm demo:reset              # ONLY for a brand-new start: DELETES all data (asks you to type "reset"). Never run automatically.
pnpm workflows:seed --publish   # after a workflow change; keeps all your data, but replaces edits made in the workflow builder
pnpm dev                        # terminal 1: http://localhost:3200
pnpm worker                     # terminal 2: runs the automations
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:3200/api/stripe/webhook   # terminal 3: only if you want the optional card payment
pnpm demo:check                 # PASS on every line you need
```

`pnpm workflows:seed --publish` publishes **seven** workflows: *Enquiry to reply*, *Site visit to quote*, *Quote and chase*,
*Job booking*, *Job to invoice*, *Invoice and payment chase* and *Review request*. Without them the matching step simply does
not start by itself (the office can still do it by hand).

`pnpm demo:check` tells you what is missing and how to fix it. Needed for the full real-integration version:
Gmail connected (Owner > Connected apps), and the customer's address on `EMAIL_ALLOWLIST` (automatic emails only go to
allowlisted addresses). Without Gmail the emails become tasks for a person. Everything else still works, so the demo degrades
gracefully - say so if it happens.

**You play the customer, too.** Use a second email address you can read (on `EMAIL_ALLOWLIST`) as the customer, and a **private
browser window** for the customer's links. The links in the emails use `APP_BASE_URL` (`http://localhost:3200`), so open them
on the same computer. Keep a third window signed in as **a technician on a phone-sized window** (`jordan@ironbark.test`).

Sign in as **Office (`office@ironbark.test`, password `Ironbark-demo-1`)** for the main story. The Owner account asks for an
authenticator code the first time (platform rule); skip it unless you want to show that off.

The seeded data (a done site visit with findings, one booked for tomorrow) only exists after a `pnpm demo:reset`.

## The story

| Min | Who | What you do | What you say |
|---|---|---|---|
| 0:00 | Office | Open the **Dashboard**. Optionally open **Schedule** first: the dashed cards are site visits. | "Sam runs a small electrical business. This is what needs attention at 7am: new enquiries, open quotes, money owed, and who is on the tools today." Point at the yellow-edged tile and the red overdue amount. |
| 1:00 | Customer | From your customer address, email the demo inbox alias (`you+ironbark@gmail.com`): "Hi, can you quote on six downlights in our lounge room? Pat". | "A customer emails the business, like they always do." |
| 1:30 | Office | **Tasks**: open *Office approves the reply*. Read the email preview: it offers a free site visit and has a **Choose a time** button. Change a sentence in the message box, then **Approve and send**. | "An AI read the email, logged the enquiry and drafted the reply. Nothing goes out until a person approves it - and the office can rewrite it first. The button is added for them: they never chase dates by email." |
| 2:30 | Customer (private window) | Open the **Choose a time** link in the email. Only free times are listed. Fill in a phone number and the address, pick tomorrow at 9:00, **Book this time**. | "The customer picks a time themselves. The system only offers times that are really free. It also asks for address. So the site visit is fully set up." |
| 3:15 | Office | **Requests**: the enquiry is now *Site visit booked*, with a client and site created. Open **Schedule**: the visit is there. | "Nobody types anything. The client, the address and the booking all come from the customer." |
| 3:45 | Technician (phone window) | **My day**: the **Site visit** card shows the address, access notes, **Call** and **Directions**. Type what was found (for example "Old fuse board, 3 circuits to add, roof space easy") and **Finish inspection**. | "At the house, the technician records what they found on their phone. No prices, no paperwork to bring back." |
| 4:30 | Office | **Tasks**: open *Office checks the draft quote*. The quote is already built from the findings, using lines from our price list. Optionally **Open the quote to edit it**, change a line, come back. **Approve**. | "AI creates a draft quote based on the job and the electrician's notes. It only picks from our own price list, it cannot invent a price.  The office reads it, edits if needed, then approves for the quote to be sent." |
| 5:15 | Customer | Open the customer's inbox: the quote email arrived, with an **Accept or decline** link. Open it in the private window and **Accept this quote**. | "Approving started the follow-up: the customer is emailed, reminded after a day, and the owner is asked to phone after three more - and it all stops the moment they answer." |
| 5:45 | Customer | Still on the page: it now asks them to **choose a day for the work**. Pick one. The page says the time is held for them. | "No back and forth about dates. The length of the job comes from the quote's labour hours, and that day is now held - nobody else can book it." |
| 6:15 | Office | **Schedule**: the dashed *Held - awaiting approval* card. **Tasks**: open *Office approves the day*, **Approve**. The customer gets a "You're booked in" email. | "Third approval. The office stays in control of the calendar: approve it, or reject it and the customer is asked to choose again." |
| 6:45 | Technician (phone window) | **My day**: the job is there. **Start / resume**, open **Add a note or variation**, add a note, **Mark complete**. | "It appears in his calendar the moment the office approves. A variation, like extra work, flows to the invoice after the office approves it." |
| 7:30 | Office | **Invoices**: open the draft invoice (drafted the moment the job was marked complete). Click **Preview the PDF**, then **Issue invoice**. If the customer is not on the automatic-email list, open **Tasks**: *Office approves sending the invoice* - edit the message if you like, then **Approve** (or **Reject** to close it without emailing). | "The invoice writes itself from the quote, any variations and any deposit. GST is right. Issuing is one click; the only task left is the office approving the email - fourth and last approval." |
| 8:15 | Customer | The invoice email arrived with the **PDF attached** and the bank transfer details (account name, BSB, account number, and the invoice number as the reference). | "A proper tax invoice, attached, with how to pay. Overdue chasing starts by itself: day 1, 7, 14, 30." |
| 8:45 | Office | **Invoices**: open the invoice, **Bank transfer received - mark paid**. | "The money lands in the bank, the office clicks once." |
| 9:15 | Customer | The inbox has a thank-you email that asks for a review. | "The customer is thanked straight away and asked for a review. If they do not reply, one gentle nudge three days later; an unhappy reply goes to the owner." |
| 9:45 | Office | Open the client's page to show the **timeline**, then the **Dashboard** and **Reports**. | "Everything the automations did is on the client's history, so nobody has to ask what happened. The owner sees conversion, how fast customers decide, how long jobs take to invoice and get paid, and what each technician brought in. Bookkeepers get a CSV." |
| 10:30 | Office | **Works for...** - open the industry that matches the prospect. | "This is an electrician. Here is what each part becomes for a clinic, a cleaner, an agency, a wholesaler - and the first automation we would build for you." |

**Short on time?** Start at 5:15. Open the seeded enquiry marked *Site visit booked* that already has a **Done** visit and a draft quote, **Send quote**
on the quote page, then use the accept link in the email and carry on from there.

**Optional, 30 seconds:** **Setup > Email templates** - open *Enquiry - approved reply* or *Invoice - sent to the customer*, change a line and watch the preview
update. "Your wording, your look - no developer needed. The automations pick the change up on the next email."

**Optional card payment:** with Stripe test keys set up, the invoice email also has a card link. Open it in the private window and pay with
`4242 4242 4242 4242`, any future date, any CVC; the invoice flips to **Paid** by itself (Stripe's webhook), and the thank-you follows. Skip it if you are
showing bank transfer.

Close with the question: **"Which of these steps is the one that costs you the most time today?"** The answer is
the first automation to build.

## Optional closer: "build a workflow from a sentence"

Workflows (Automation section) > the AI assistant. Ask for something in the prospect's words (for example "when a client
pays an invoice, send them a thank you and ask for a review"). Needs the AI assistant configured; **not yet
rehearsed here**, so try it before relying on it.

## Real vs. simulated

| Real | Simulated or limited |
|---|---|
| Gmail: inbound enquiry and outbound email (automatic emails only to addresses on `EMAIL_ALLOWLIST`) | The AI triage in test runs uses a built-in mock |
| Availability: working hours, travel time, held days, the electrician chosen by code | Working hours (Mon-Fri 8-4), one-hour visits and a 12-hour notice are fixed settings |
| Quote drafted from the findings with the AI when `ANTHROPIC_API_KEY` is set (price-list lines only) | Without the key it matches the wording to the price list by keyword |
| The invoice PDF, built and attached to the email | The bank account is fictional (`BANK_*` in `.env` changes it); paying is "mark paid" by the office |
| Temporal workflows with real waits (production mode) | Test mode caps waits at 5 seconds |
| Optional Stripe test-mode card payment and webhook | Test mode only: no real money |
| Users, roles, data, reports | Fictional business and data. The review link is a placeholder |

Fully automatic email (quote and invoice chases, booking confirmations, the thank-you) only goes to addresses on `EMAIL_ALLOWLIST`; with no allowlist none is sent and the
step hands the job to a person. A reply a person has read and approved can go to any sender.

## If something goes wrong

| Symptom | Fix |
|---|---|
| No email arrived | `pnpm demo:check`. Is the worker running? Is the recipient on `EMAIL_ALLOWLIST`? Is Gmail connected? |
| The enquiry did not start a run | The mail must be sent **to** the `+ironbark` alias, from outside the connected account. |
| Tasks shows a problem instead of the email | You skipped `pnpm workflows:seed --publish` after pulling: the stored workflow predates the booking link. Run it. |
| The customer's link does not open | It uses `APP_BASE_URL` (`http://localhost:3200`): open it on the same computer, with `pnpm dev` running. |
| The booking page shows no times | Times are Monday to Friday, 8am to 4pm, at least 12 hours ahead, and a longer job needs room before closing. If everything is booked it says so; look at **Schedule**. |
| No draft quote appeared after the visit | The *Site visit to quote* workflow is not published, or the enquiry already had a quote or no client. The run says why under **Runs**. Create the quote by hand from the request page instead. |
| The draft quote has no lines | Nothing in the price list matched the wording. Open the quote and add lines (the task says so). |
| "Approve the day" says the time is no longer held | Held days lapse after 3 days. Reject: the customer is emailed to choose another day. |
| No invoice appeared after marking the job complete | The *Job to invoice* workflow is not published, or the job had no quote or already had an invoice. Create it by hand from the job page. |
| The invoice email had no PDF | It is attached when the email is sent by the automation. If the invoice went by hand (a task), use **Download PDF** on the invoice page. |
| No thank-you after "mark paid" | The customer's address is not on `EMAIL_ALLOWLIST`, or the *Review request* workflow is not published. |
| Invoice has no card link | Stripe keys missing in `.env`; restart `pnpm dev`. The bank details are always there. |
| Card payment did not flip the invoice to Paid | `stripe listen` is not running, is logged into a different Stripe account than `STRIPE_SECRET_KEY` (start it with `--api-key "$STRIPE_SECRET_KEY"`), or its `whsec_...` is not in `STRIPE_WEBHOOK_SECRET`. Payments already made can be recorded afterwards with `pnpm payments:replay`. |
| The visit is not in the technician's My day | It is booked for a different technician, or more than a week ahead. Check the name on the request's **Site inspection** card. |
| "Book a site visit" is missing | The enquiry is not linked to a client yet, or it has already been quoted. |
| Page says something went wrong | Reload; if it repeats, check the `pnpm dev` terminal. |
| Everything is a mess | Only if you are happy to lose all current data: `pnpm demo:reset` (it asks you to type "reset"). |

## Rehearsal log

Every stage of this story has automated tests of its rules (availability and booking, edit-before-approve, the draft quote, the held day
and its approval, the draft invoice, the PDF and its email attachment). **The whole chain has not yet been run end to end in a browser
or through Temporal with real email:** rehearse the full story once, from your customer address, before showing it, and note here what you find.

The earlier human-only path (enquiry to client to quote to approval to job to schedule to technician to invoice to payment to dashboard and
reports) was driven end to end in a browser against a clean seed with automations off: 21 checks, no errors, before the automations
described above were added. The real Gmail, Stripe card and AI-assistant moments need a live rehearsal by you with your accounts.
