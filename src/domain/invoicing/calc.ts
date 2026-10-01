/**
 * Invoice money and overdue rules (requirements 5.7, section 6 workflow 3). Pure.
 * Lines are ex GST; GST is 10% of the subtotal (the same rule as quotes); a
 * deposit already received is credited against the total incl GST.
 */
import { computeTotals } from "../quotes/calc";

export { GST_RATE_PCT } from "../quotes/calc";

export const PAYMENT_TERMS_DAYS = 7;

export interface InvoiceTotals {
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  /** Deposit applied, capped at the total so the balance never goes negative. */
  creditCents: number;
}

export function invoiceTotals(lines: { quantity: number; unitPriceCents: number }[], depositReceivedCents: number): InvoiceTotals {
  const t = computeTotals(lines);
  return {
    subtotalCents: t.subtotalCents,
    gstCents: t.gstCents,
    totalCents: t.totalCents,
    creditCents: Math.min(Math.max(depositReceivedCents, 0), t.totalCents),
  };
}

/** What is still owed: total - deposit credit - payments received. Never below zero. */
export function balanceDueCents(totalCents: number, creditCents: number, paidCents: number): number {
  return Math.max(0, totalCents - creditCents - paidCents);
}

export type InvoiceStatusValue = "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "VOID";
export type EffectiveInvoiceStatus = InvoiceStatusValue | "OVERDUE";

export const INVOICE_STATUS_LABEL: Record<EffectiveInvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
  OVERDUE: "Overdue",
};

/** An issued invoice with money still owing past its due date reads as overdue. */
export function effectiveInvoiceStatus(status: InvoiceStatusValue, dueAt: Date | null, balanceCents: number, now: Date = new Date()): EffectiveInvoiceStatus {
  if ((status === "SENT" || status === "PARTIALLY_PAID") && dueAt && balanceCents > 0 && dueAt.getTime() < now.getTime()) return "OVERDUE";
  return status;
}

/** Whole days past the due date (0 if not yet due). */
export function daysOverdue(dueAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000));
}

export type ChaseStage = { stage: 0 | 1 | 7 | 14 | 30; action: string };

/**
 * Where an overdue invoice sits on the chasing cadence: day 1 a friendly email
 * reminder, day 7 a call, day 14 a formal notice, day 30 escalate to the owner.
 * The stage is the latest one reached; the workflow sends each stage once.
 */
export function chaseStage(daysPastDue: number): ChaseStage {
  if (daysPastDue >= 30) return { stage: 30, action: "Escalate to the owner" };
  if (daysPastDue >= 14) return { stage: 14, action: "Send a formal payment notice" };
  if (daysPastDue >= 7) return { stage: 7, action: "Call the customer" };
  if (daysPastDue >= 1) return { stage: 1, action: "Send a friendly reminder" };
  return { stage: 0, action: "Not overdue" };
}
