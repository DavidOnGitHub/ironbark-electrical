import { appDb } from "../../db/app";
import { dayKey } from "../../lib/tz";
import { staffLabelMap } from "../shared/staff";
import { billingLag, enquiryFunnel, monthlyReceipts, quoteStats, revenueByTechnician } from "./calc";

export const REPORT_WINDOWS = [30, 90, 365] as const;
export type ReportWindow = (typeof REPORT_WINDOWS)[number];

const monthKeyOf = (d: Date) => dayKey(d).slice(0, 7);

/** The owner's numbers for the last `days` days (and six months of receipts). */
export async function businessReport(days: ReportWindow, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const sixMonthsAgo = new Date(now.getTime() - 200 * 86_400_000);
  const [requests, quotes, jobs, payments, names] = await Promise.all([
    appDb.request.findMany({ where: { receivedAt: { gte: since } }, select: { id: true, receivedAt: true, status: true, _count: { select: { quotes: true } } } }),
    appDb.quote.findMany({ where: { sentAt: { gte: since } }, select: { sentAt: true, decidedAt: true, status: true } }),
    appDb.job.findMany({
      where: { completedAt: { gte: since } },
      select: { completedAt: true, assignedUserId: true, invoices: { where: { status: { not: "VOID" } }, orderBy: { issuedAt: "desc" }, take: 1, select: { issuedAt: true, paidAt: true, subtotalCents: true, status: true } } },
    }),
    appDb.payment.findMany({ where: { paidAt: { gte: sixMonthsAgo } }, select: { paidAt: true, amountCents: true } }),
    staffLabelMap(),
  ]);
  const jobRows = jobs.map((j) => {
    const inv = j.invoices[0];
    const issued = inv && inv.status !== "DRAFT" ? inv : null;
    return { completedAt: j.completedAt, assignedUserId: j.assignedUserId, invoiceIssuedAt: issued?.issuedAt ?? null, invoicePaidAt: issued?.paidAt ?? null, invoiceSubtotalCents: issued ? issued.subtotalCents : null };
  });
  return {
    days,
    funnel: enquiryFunnel(requests.map((r) => ({ id: r.id, receivedAt: r.receivedAt, status: r.status, hasQuote: r._count.quotes > 0 }))),
    quotes: quoteStats(quotes),
    billing: billingLag(jobRows),
    technicians: revenueByTechnician(jobRows).map((t) => ({ ...t, name: t.userId ? (names.get(t.userId) ?? "Unknown") : "Unassigned" })),
    receipts: monthlyReceipts(payments, monthKeyOf, now, 6),
  };
}
