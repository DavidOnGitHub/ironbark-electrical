/**
 * Quote money rules (requirements 5.5). Pure, so they are unit-tested to the
 * cent. Everything is integer cents; amounts on lines are ex GST.
 */
export const GST_RATE_PCT = 10;
/** Jobs with a total (incl GST) over this need a deposit. */
export const DEPOSIT_THRESHOLD_CENTS = 150_000;
export const DEPOSIT_PCT = 30;
export const VALIDITY_DAYS = 14;

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
}

/** round(quantity x unit price), half up, in cents. */
export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents + Number.EPSILON);
}

export interface QuoteTotals {
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  depositRequired: boolean;
  depositPct: number;
  depositCents: number;
}

/** GST is 10% of the subtotal (not summed per line), rounded half up. */
export function computeTotals(lines: LineInput[]): QuoteTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l.quantity, l.unitPriceCents), 0);
  const gstCents = Math.round((subtotalCents * GST_RATE_PCT) / 100 + Number.EPSILON);
  const totalCents = subtotalCents + gstCents;
  const depositRequired = totalCents > DEPOSIT_THRESHOLD_CENTS;
  const depositCents = depositRequired ? Math.round((totalCents * DEPOSIT_PCT) / 100 + Number.EPSILON) : 0;
  return { subtotalCents, gstCents, totalCents, depositRequired, depositPct: depositRequired ? DEPOSIT_PCT : 0, depositCents };
}

/** A material's sell price from cost and markup. */
export function materialPriceCents(costCents: number, markupPct: number): number {
  return Math.round(costCents * (1 + markupPct / 100) + Number.EPSILON);
}

export type QuoteStatusValue = "DRAFT" | "SENT" | "APPROVED" | "DECLINED" | "EXPIRED";

/** A SENT quote past its validity date reads as EXPIRED, without a stored change. */
export function effectiveQuoteStatus(status: QuoteStatusValue, validUntil: Date, now: Date = new Date()): QuoteStatusValue {
  return status === "SENT" && validUntil.getTime() < now.getTime() ? "EXPIRED" : status;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  APPROVED: "Approved",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

/** How long a job is likely to take, from the quote's labour: the hours on its "hour" lines, kept between one hour and one
 * working day (a longer job books its first day), and three hours when the quote has no labour hours at all. */
export function jobDurationMinutes(lines: { unit: string; quantity: number | string | { toString(): string } }[]): number {
  const hours = lines.filter((l) => l.unit.trim().toLowerCase() === "hour").reduce((sum, l) => sum + Number(l.quantity.toString()), 0);
  if (!(hours > 0)) return 180;
  return Math.min(480, Math.max(60, Math.round(hours * 60)));
}
