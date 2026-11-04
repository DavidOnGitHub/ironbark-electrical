# Billing: invoices, payments and reporting

Money is integer cents; invoice lines are ex GST. Rules marked "(inferred)" come from the code only and are not confirmed by a test or doc.

## Invoices (INV)

- BR-INV-1: An invoice is drafted only for a COMPLETED job that has a quote and no other non-void invoice; invoices are numbered INV-3001 upward.
- BR-INV-2: A drafted invoice has one line per quote line plus one line per approved variation (described "Variation: ..." at quantity 1).
- BR-INV-3: Invoice GST is 10% of the subtotal using the same rounding as quotes, and the total is subtotal plus GST.
- BR-INV-4: A deposit already received for the job and not yet applied is credited against the total including GST, never more than the total and never below zero.
- BR-INV-5: The balance due is total minus deposit credit minus invoice payments, and never goes below zero.
- BR-INV-6: Only a DRAFT invoice can be edited; it must keep at least one line (at most 60), each with a description (1-300 characters), a quantity above zero and at most 10,000, and a unit price between -$100,000.00 and $100,000.00; totals are recomputed and the applied deposit credit stays.
- BR-INV-7: Only a DRAFT invoice with at least one line and a total above zero can be issued.
- BR-INV-8: Issuing sets the due date to 7 days after issue and moves the job to INVOICED.
- BR-INV-9: An invoice whose balance is already zero when issued (fully covered by deposit) becomes PAID immediately and its job becomes PAID.
- BR-INV-10: An issued (SENT or PARTIALLY_PAID) invoice with money owing past its due date reads as OVERDUE without any stored change; PAID, DRAFT and VOID never read as overdue.
- BR-INV-11: Days overdue are whole days past the due date, never negative.
- BR-INV-12: Overdue chasing stages are: day 1 friendly reminder email, day 7 call the customer, day 14 formal payment notice, day 30 escalate to the owner; the stage is the latest one reached and each stage is sent once.
- BR-INV-13: Only a DRAFT invoice, or a SENT invoice with no payments, can be voided, and a reason of 1-300 characters is required.
- BR-INV-14: Voiding releases the deposit credit back to the job, and voiding a SENT invoice returns the job to COMPLETED so it can be invoiced again.
- BR-INV-15: Invoice amounts shown in CSV export are in dollars with two decimals, and the export lists payments separately; a deposit not yet on an invoice is shown as "(deposit held)".

## Payments and deposits (PAY)

- BR-PAY-1: A payment needs a positive whole-cent amount and a method of CARD, BANK, CASH or STRIPE.
- BR-PAY-2: A payment can be recorded only against a SENT or PARTIALLY_PAID invoice, and it cannot be more than the balance still owing; part payments are allowed.
- BR-PAY-3: A payment that clears the balance sets the invoice to PAID with a paid date and the job to PAID; otherwise the invoice is PARTIALLY_PAID.
- BR-PAY-4: A deposit can be recorded only for a job whose quote required one and that has no non-void invoice, and the deposits received cannot exceed the quote's deposit amount.
- BR-PAY-5: A deposit is held against the job and credited to the job's invoice when it is created.
- BR-PAY-6: Only a `checkout.session.completed` Stripe event with status paid, a positive amount and an invoice id in its metadata records a payment; every other event is ignored.
- BR-PAY-7: The same Stripe payment is recorded only once, even if Stripe retries the webhook.
- BR-PAY-8: A Stripe payment that cannot be recorded (for example more than is owing) is not recorded and the webhook still answers success so Stripe does not retry.
- BR-PAY-9: Stripe webhook signatures are verified over the raw body and rejected if the timestamp is more than 5 minutes off.
- BR-PAY-10: A card payment link is offered only for a SENT or PARTIALLY_PAID invoice with a balance, for exactly the balance still owing, in AUD.
- BR-PAY-11: A stored payment link is reused only if Stripe says it is still open for exactly the current balance; otherwise a new one replaces it.
- BR-PAY-12: Without a Stripe key, invoices simply have no payment link.
- BR-PAY-13: Direct bank transfer details come from BANK_* settings (fictional defaults) and the invoice number is the payment reference.

## Reports (RPT)

- BR-RPT-1: Percentages are whole numbers and are blank when there is nothing to divide by.
- BR-RPT-2: Quote approval rate counts only quotes that were sent; median days to decision uses only approved or declined quotes with both dates.
- BR-RPT-3: Billing lag is the median days from completion to invoice issue and from issue to paid, each never negative.
- BR-RPT-4: Revenue by technician is invoiced subtotal ex GST, biggest first, with unassigned work grouped together.
- BR-RPT-5: Monthly receipts cover the last 6 calendar months in Sydney time, oldest first, with months without payments shown as zero.
- BR-RPT-6: A report query must name a known dataset, a date field and group supported by that dataset, and a date range with both `from` and `to` as YYYY-MM-DD, `to` not before `from`, and no longer than about 800 days.
- BR-RPT-7: The dashboard's open quotes are quotes SENT and still within validity.
- BR-RPT-8: Money received this month is counted from the start of the month in UTC (inferred from the code; other reports use Sydney time).
