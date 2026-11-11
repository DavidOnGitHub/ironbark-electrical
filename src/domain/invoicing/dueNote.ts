const DAY_MS = 86_400_000;

export interface DueInput {
  status: string;
  dueAt: Date | null;
  paidAt: Date | null;
}

/**
 * The line under "Due" on the invoices list: how long an issued invoice has left, or how late it is.
 *
 * DEMO: while the staging-only demo bug "invoice-due" is on (`demoBug`), this measures from the payment date,
 * which an invoice that has not been paid does not have, so it throws. The IT assistant's job in the demo is to find
 * that, add a test that fails, and fix it.
 */
export function dueNote(i: DueInput, now: Date = new Date(), demoBug = false): string | null {
  if (i.status !== "SENT" && i.status !== "PARTIALLY_PAID") return null;
  if (!i.dueAt) return null;
  const from = demoBug ? i.paidAt!.getTime() : now.getTime();
  const days = Math.ceil((i.dueAt.getTime() - from) / DAY_MS);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  return days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;
}
