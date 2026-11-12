# Fix /quotes crash when a quote has no valid-until date

**Type:** bug

The Quotes list crashes with "Cannot read properties of null (reading 'getTime')" when a SENT quote row comes back with a null validUntil. listQuotes maps every row through withEffectiveStatus, which calls effectiveQuoteStatus(status, validUntil). That function calls validUntil.getTime() for any SENT quote with no null guard. The Prisma schema declares validUntil NOT NULL and no migration changes that, so the null is bad data in the running database, not something this code writes. The fix is defensive: a null validUntil must not crash the list. The status is left as is (SENT), because expiry can't be judged without a date, and the "Valid to" cell shows "-". The Prisma schema, migrations and data are not touched, since they are protected paths.

## User stories

- As office staff, I want the Quotes list to load even if one quote has a missing valid-until date, so that I can still see and work with my quotes.

## Reproduction

1. Have a quote with status SENT whose validUntil is null (bad data; the Prisma type says Date).
2. Open /quotes (listQuotes runs withEffectiveStatus on each row).
3. effectiveQuoteStatus('SENT', null) evaluates null.getTime().

**Expected:** The Quotes list renders. The quote shows its stored status (Sent) and '-' in the Valid to column.

**Actual:** TypeError: Cannot read properties of null (reading 'getTime') and the page shows an error.

## Acceptance criteria

- **AC-1** Regression test in test/rules.test.ts (pure, no data needed): Given status SENT and a null validUntil (cast to Date), when effectiveQuoteStatus(status, validUntil, now) is called, then it does not throw and returns 'SENT'. The test fails before the fix with the TypeError and passes after.
- **AC-2** Given a SENT quote with a valid past validUntil, effectiveQuoteStatus still returns 'EXPIRED'. Given a SENT quote with a future validUntil it returns 'SENT'. Other statuses are unchanged (existing tests in test/rules.test.ts still pass).
- **AC-3** Given a quote with a null validUntil in the list, when /quotes renders, then the Valid to cell shows '-' instead of calling toLocaleDateString on null, and the page does not throw.
- **AC-4** effectiveQuoteStatus accepts a Date or null/undefined for validUntil. withEffectiveStatus in src/domain/quotes/index.ts still type-checks. pnpm lint and pnpm typecheck pass.

## Edge cases

- SENT quote with null validUntil: shows as Sent with '-' in Valid to, and no crash.
- DRAFT, APPROVED and DECLINED quotes with a null validUntil: already safe because getTime() is only reached for SENT. They must stay safe.
- A SENT quote with a null date is excluded from the SENT and EXPIRED filter tabs by the database date comparison. That is acceptable and left as is.
- Other pages that call .toLocaleDateString() on validUntil (quote detail, accept page, emails) are not changed in this fix.

## Business rules

- `docs/business/sales.md#BR-QUO-8` (unchanged): A SENT quote past its valid-until date reads as EXPIRED without any stored change; other statuses are unaffected. - Behaviour is unchanged for quotes with a date. A SENT quote with no date can't be judged expired, so it reads as SENT instead of crashing.

## Out of scope

- Finding out how a null validUntil got into the production database. The schema is NOT NULL, so this is likely a data or deploy mismatch to check separately.
- Prisma schema and migrations, and data repair of existing rows (protected paths).
- Null-proofing the quote detail page, the customer accept page and emails.
- Any change to the expiry rule or the quote status flow.

## Affected areas

- src/domain/quotes/calc.ts (effectiveQuoteStatus: guard a missing validUntil)
- src/domain/quotes/index.ts (withEffectiveStatus type only, if needed)
- app/quotes/page.tsx (Valid to cell: show '-' when validUntil is missing)
- test/rules.test.ts (new regression test)
