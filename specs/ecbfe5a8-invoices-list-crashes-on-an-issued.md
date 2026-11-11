# Invoices list crashes on an issued invoice with no due date

**Type:** bug

/invoices threw "Cannot read properties of null (reading 'getTime')" while mapping invoice rows. Invoice.dueAt is nullable (a DRAFT has none, and bad or legacy data can leave a SENT or PARTIALLY_PAID invoice without one). The overdue calculation in src/domain/invoicing/calc.ts calls .getTime() on dueAt, and daysOverdue() takes a non-null Date and throws when handed null. The fix makes the overdue calculations treat a missing due date as "not overdue" (0 days, status unchanged), so one bad row cannot take down the whole list.

## Reproduction

1. Have an invoice with status SENT or PARTIALLY_PAID and dueAt = null (for example created by a data fix or an older release).
2. Open /invoices, which runs listInvoices() and maps every row through withInvoiceFigures().

**Expected:** The list renders; the invoice with no due date shows its stored status, Due "-" and 0 days overdue.

**Actual:** The page errors with TypeError: Cannot read properties of null (reading 'getTime') raised inside the Array.map over invoice rows.

## Acceptance criteria

- **AC-1** Regression test (test/invoicing.rules.test.ts): Given a null due date, When daysOverdue(null, now) is called, Then it returns 0 and does not throw. This test fails before the fix (TypeError reading 'getTime') and passes after.
- **AC-2** Regression test: Given effectiveInvoiceStatus is called with status SENT or PARTIALLY_PAID, a null dueAt and a balance above zero, Then it returns the stored status (not OVERDUE) and does not throw.
- **AC-3** Regression test (test/invoicing.test.ts, DB-backed): Given a SENT invoice and a PARTIALLY_PAID invoice whose dueAt is null, plus an overdue invoice, When listInvoices() runs, Then it resolves without error, the null-due invoices report their stored status and daysOverdue 0, and the genuinely overdue invoice still reads OVERDUE with the right days (BR-INV-10, BR-INV-11).
- **AC-4** Given the existing overdue, chase-stage and receivables tests, When the fix is applied, Then they still pass unchanged.

## Edge cases

- SENT or PARTIALLY_PAID invoice with dueAt null: shows its stored status, Due "-", no overdue days.
- DRAFT and VOID invoices have a null dueAt by design and must keep working.
- Invoice due exactly now or in the future is not overdue (unchanged).
- The dashboard receivablesSummary shares withInvoiceFigures, so it must not crash on the same data.

## Business rules

- `docs/business/billing.md#BR-INV-10` (unchanged): An issued invoice with money owing past its due date reads as OVERDUE without any stored change; PAID, DRAFT and VOID never read as overdue. - An invoice with no due date can never be past due, so it keeps its stored status.
- `docs/business/billing.md#BR-INV-11` (unchanged): Days overdue are whole days past the due date, never negative. - No due date gives 0 days.

## Out of scope

- Backfilling due dates on existing invoices (a data change).
- The unguarded validUntil.getTime() in src/domain/quotes/calc.ts, which is a separate quotes issue.
- The deployed release is origin/staging (c8e62d6) and the checked-out code is main. On main, effectiveInvoiceStatus and withInvoiceFigures already guard a null dueAt, so the exact throwing line in staging could not be confirmed. The fix and tests target the one unguarded path on main (daysOverdue). If the guard in the staging build is missing, this change also covers it.
- Schema or migration changes (protected path).

## Affected areas

- src/domain/invoicing/calc.ts (daysOverdue accepts Date | null; returns 0 for null)
- src/domain/invoicing/index.ts (withInvoiceFigures: only if needed)
- test/invoicing.rules.test.ts
- test/invoicing.test.ts

## Data changes

None.
