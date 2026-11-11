# Fix Invoices list crash: dueNote reads paidAt of an unpaid invoice

**Type:** bug

The /invoices page crashes with "Cannot read properties of null (reading 'getTime')" whenever any invoice is SENT or PARTIALLY_PAID and the staging demo switch "invoice-due" is on (IT_DEMO_BREAK=on plus its AppFlag). In `src/domain/invoicing/dueNote.ts`, `dueNote(i, now, demoBug)` computes `from = demoBug ? i.paidAt!.getTime() : now.getTime()`. An unpaid invoice has paidAt = null, so it throws and the page render fails. Earlier fixes did not hold because the broken branch stayed in the code and the switch can be turned on again. The fix removes the broken branch so dueNote always measures from `now` and can never throw on a null paidAt. No business rule changes: the "due in N days / N days late" line is a display note only.

## User stories

- As office staff, I want the Invoices list to load even when invoices are issued but unpaid, so that I can see what is owed and when it is due.

## Reproduction

1. Run with IT_DEMO_BREAK=on and switch on the demo bug 'invoice-due' (AppFlag demo-bug:invoice-due enabled).
2. Have at least one invoice with status SENT or PARTIALLY_PAID, a dueAt, and paidAt = null.
3. Open /invoices (or call dueNote({status:'SENT', dueAt, paidAt:null}, now, true)).

**Expected:** The list renders; the Due column shows e.g. 'due in 3 days' or '1 day late'.

**Actual:** TypeError: Cannot read properties of null (reading 'getTime') from dueNote (i.paidAt!.getTime()); the Invoices page shows an error.

## Acceptance criteria

- **AC-1** Regression test (test/demo.test.ts, 'dueNote' block): Given an invoice {status:'SENT', dueAt: 3 days after now, paidAt:null}, When dueNote is called the way the page calls it with the demo switch on (third argument true, if the parameter is still accepted), Then it does not throw and returns 'due in 3 days'. This test fails before the fix (TypeError) and passes after.
- **AC-2** Given SENT or PARTIALLY_PAID invoices with paidAt null, When /invoices renders with the 'invoice-due' demo switch on, Then no error is raised and each row shows 'due in N day(s)', 'due today' or 'N day(s) late' measured from now.
- **AC-3** dueNote no longer reads paidAt: the `paidAt!` non-null assertion and the demoBug-only branch are removed from src/domain/invoicing/dueNote.ts, and app/invoices/page.tsx no longer needs isDemoBugOn('invoice-due') to render the note.
- **AC-4** Existing dueNote behaviour is unchanged: DRAFT, PAID, VOID or no dueAt returns null; day counts and wording stay as in the current normal-path tests.
- **AC-5** The obsolete test 'with the bug on, fails on an unpaid invoice' (expects TypeError) is removed or replaced by AC-1. The 'invoice-due' entry is removed from DEMO_BUGS in src/domain/demo/index.ts, since its bug no longer exists, and demo.test.ts assertions that relied on it (the 'invoice-due' isDemoBugOn check and the resetDemoBugs count) are updated to still pass using the remaining demo bugs.

## Edge cases

- Invoice PARTIALLY_PAID: paidAt may be null or set; the note must still measure from now.
- dueAt null returns null (unchanged).
- Other list pages (quotes validityNote, jobs visitNote) use the same demo-switch pattern; they are not touched here.

## Business rules

- `docs/business/billing.md#BR-INV-10` (unchanged): An issued invoice with money owing past its due date reads as OVERDUE without any stored change. - The fix touches only the display note under Due, not the overdue status.

## Out of scope

- The same demo-bug pattern in quotes (validityNote) and jobs (visitNote); they are not this error.
- Changing business rules or invoice overdue logic (BR-INV-10/11).
- Database or schema changes; none needed.
- Payments code and Stripe.

## Affected areas

- src/domain/invoicing/dueNote.ts
- app/invoices/page.tsx
- src/domain/demo/index.ts
- test/demo.test.ts

## Data changes

None. No migration. A leftover AppFlag row for demo-bug:invoice-due becomes inert.
