# Access, automations and email safety

Rules marked "(inferred)" come from the code only and are not confirmed by a test or doc.

## Access (ACC)

- BR-ACC-1: Business labels map to platform roles: Owner is ADMIN, Office is EDITOR, Technician is OPERATOR and Bookkeeper is VIEWER.
- BR-ACC-2: Owner and Office can read and write clients, enquiries, quotes, jobs, invoices, email templates and the price list.
- BR-ACC-3: Bookkeeper can read clients, quotes, jobs, invoices, the dashboard and reports, and cannot write or see the enquiry pipeline, price list or email templates.
- BR-ACC-4: Technician has only the field view of their own jobs; Technician, Owner and Office can see "my day".
- BR-ACC-5: Role checks are enforced in pages and server actions (and technician scoping in the jobs and site visit modules), never only in the UI.

## Automations (AUT)

- BR-AUT-1: A workflow starts for real only when it is PUBLISHED; a draft never runs for real, and drafts and test runs never contact anyone or change business data.
- BR-AUT-2: Setting `AUTOMATIONS=off` stops every automation from starting.
- BR-AUT-3: Published workflows start automatically when a quote is marked sent, when an invoice is issued, and when an invoice is paid.
- BR-AUT-4: A failure to start an automation is logged and never undoes the business action or raises an error.
- BR-AUT-5: A quote is sent by a person's deliberate click; the customer's email carries a private accept/decline link, and the quote-and-chase workflow emails it (after approval for an address not on the allowlist).
- BR-AUT-6: An approval task can name one email variable a person may rewrite; approving an editable task needs non-empty edited text of at most 6,000 characters, and rejecting hands the run `approved: false`.
- BR-AUT-7: Workflow steps that find the recipient not allowed, or no connected Gmail account, fall back to a task for a person instead of sending.
- BR-AUT-8: Accepting a quote (by the customer or the office) stops the quote chase (inferred from the README and the stop-chase tests).

## Email safety and templates (EML)

- BR-EML-1: Automations may only email allowed recipients; with no `EMAIL_ALLOWLIST` set nobody is allowed (deny by default).
- BR-EML-2: The allowlist holds exact addresses and/or `@domain` entries; `*` allows everyone only when written explicitly, and an empty address is never allowed.
- BR-EML-3: Gmail addresses are matched ignoring `+tags` and dots in the local part; other domains ignore only `+tags` in this matching (inferred) and Gmail rules are not applied to them.
- BR-EML-4: Every automated email comes from a template with a subject and message and `{{variables}}`; a variable that is not supplied stops the email with a clear message, also in a test run.
- BR-EML-5: A template that a workflow uses cannot be deleted.
- BR-EML-6: Templates are managed by Owner and Office only.
- BR-EML-7: Each email is rendered as branded HTML with a plain-text twin.
- BR-EML-8: An email with an empty recipient is not sent.

## IT assistant (IT)

- BR-IT-1: An IT request is a change the business asked for, or an error or security finding the assistant noticed. Each is numbered IT-1001, IT-1002, ... and is one AI Builder session whose progress it mirrors.
- BR-IT-2: A request that names a source (an error or a finding) reuses the open request for that source instead of starting a second; once that request is Done or Closed, a new one may open.
- BR-IT-3: Errors and findings are handled automatically (the assistant asks no questions); a change asked for by a person goes through a plan they approve. Either way the assistant only opens pull requests, and a person accepts the finished change.
- BR-IT-4: Owner and Office act as approvers in the assistant (they approve plans and accept changes); everyone else can only ask for changes.
- BR-IT-5: A request's status follows the assistant's session: working out the plan, needs answers, plan ready to approve, building, build needs attention, ready to try, accepted, done, closed, failed. A status the app does not recognise reads as failed. Done and Closed are final.
- BR-IT-6: If the assistant cannot be reached, a new request stays Submitted with the reason shown and is retried every minute; it is never lost, and only one process creates the session.
- BR-IT-7: Page context, error text and finding details are untrusted data: they are passed to the assistant as data, never as instructions.

