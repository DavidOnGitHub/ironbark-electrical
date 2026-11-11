const DAY_MS = 86_400_000;

export interface DueInput {
  status: string;
  dueAt: Date | null;
  paidAt: Date | null;
}

/**
 * The line under "Due" on the invoices list: how long an issued invoice has left, or how late it is.
 * Always measured from `now`; it never reads `paidAt`, which an unpaid invoice does not have.
 */
export function dueNote(i: DueInput, now: Date = new Date()): string | null {
  if (i.status !== "SENT" && i.status !== "PARTIALLY_PAID") return null;
  if (!i.dueAt) return null;
  const days = Math.ceil((i.dueAt.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  return days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;
}
