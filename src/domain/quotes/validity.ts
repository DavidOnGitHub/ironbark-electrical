import type { QuoteStatusValue } from "./calc";

const DAY_MS = 86_400_000;

export interface ValidityInput {
  status: QuoteStatusValue;
  /** Never null in the schema; tolerated so one bad row cannot crash the list. */
  validUntil: Date | null | undefined;
  decidedAt: Date | null;
}

/**
 * The line under "Valid to" on the quotes list: how long a sent quote has left.
 *
 * DEMO: while the staging-only demo switch is on (`demoBug`), this takes the old, wrong path - it measures from
 * the decision date, which a quote that is still waiting for an answer does not have, so it throws. The IT
 * assistant's job in the demo is to find that, add a test that fails, and fix it.
 */
export function validityNote(q: ValidityInput, now: Date = new Date(), demoBug = false): string | null {
  if (q.status !== "SENT" || q.validUntil == null) return null;
  const from = demoBug ? q.decidedAt!.getTime() : now.getTime();
  const days = Math.ceil((q.validUntil.getTime() - from) / DAY_MS);
  if (days < 0) return "expired";
  return days === 0 ? "expires today" : `${days} day${days === 1 ? "" : "s"} left`;
}
