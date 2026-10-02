/** Pure KPI maths for the reports page (no database): rows in, numbers out. */

const DAY_MS = 86_400_000;

export type RequestRow = { id: string; receivedAt: Date; status: string; hasQuote: boolean };
export type QuoteRow = { sentAt: Date | null; decidedAt: Date | null; status: string };
export type JobRow = { completedAt: Date | null; assignedUserId: string | null; invoiceIssuedAt: Date | null; invoicePaidAt: Date | null; invoiceSubtotalCents: number | null };

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

/** A fraction as a whole percent, or null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

export function enquiryFunnel(requests: RequestRow[]) {
  const total = requests.length;
  const quoted = requests.filter((r) => r.hasQuote).length;
  const won = requests.filter((r) => r.status === "WON").length;
  return { total, quoted, won, quotedPct: pct(quoted, total), wonPct: pct(won, total) };
}

export function quoteStats(quotes: QuoteRow[]) {
  const sent = quotes.filter((q) => q.sentAt);
  const approved = sent.filter((q) => q.status === "APPROVED");
  const decided = sent.filter((q) => q.decidedAt && (q.status === "APPROVED" || q.status === "DECLINED"));
  return {
    sent: sent.length,
    approved: approved.length,
    approvalPct: pct(approved.length, sent.length),
    medianDaysToDecision: median(decided.map((q) => daysBetween(q.sentAt!, q.decidedAt!))),
  };
}

export function billingLag(jobs: JobRow[]) {
  const toInvoice = jobs.filter((j) => j.completedAt && j.invoiceIssuedAt).map((j) => Math.max(0, daysBetween(j.completedAt!, j.invoiceIssuedAt!)));
  const toPaid = jobs.filter((j) => j.invoiceIssuedAt && j.invoicePaidAt).map((j) => Math.max(0, daysBetween(j.invoiceIssuedAt!, j.invoicePaidAt!)));
  return { medianDaysToInvoice: median(toInvoice), medianDaysToPaid: median(toPaid) };
}

/** Invoiced revenue (ex GST) per technician, biggest first; unassigned work is grouped. */
export function revenueByTechnician(jobs: JobRow[]) {
  const totals = new Map<string | null, { cents: number; jobs: number }>();
  for (const j of jobs) {
    if (j.invoiceSubtotalCents == null) continue;
    const t = totals.get(j.assignedUserId) ?? { cents: 0, jobs: 0 };
    t.cents += j.invoiceSubtotalCents;
    t.jobs += 1;
    totals.set(j.assignedUserId, t);
  }
  return [...totals.entries()].map(([userId, t]) => ({ userId, ...t })).sort((a, b) => b.cents - a.cents);
}

/** Last `months` calendar months (oldest first) with the amount received in each. Keys are "YYYY-MM" in Sydney time. */
export function monthlyReceipts(payments: { paidAt: Date; amountCents: number }[], monthKeyOf: (d: Date) => string, now: Date, months = 6) {
  const keys: string[] = [];
  const [y, m] = monthKeyOf(now).split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const sums = new Map(keys.map((k) => [k, 0]));
  for (const p of payments) {
    const k = monthKeyOf(p.paidAt);
    if (sums.has(k)) sums.set(k, sums.get(k)! + p.amountCents);
  }
  return keys.map((key) => ({ key, cents: sums.get(key)! }));
}
