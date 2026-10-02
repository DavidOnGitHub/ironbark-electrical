import { describe, expect, it } from "vitest";
import { billingLag, enquiryFunnel, median, monthlyReceipts, pct, quoteStats, revenueByTechnician } from "../src/domain/reports/calc";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("report maths", () => {
  it("median handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("pct is null with nothing to divide by", () => {
    expect(pct(1, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33);
  });
  it("funnel counts quoted and won enquiries", () => {
    const f = enquiryFunnel([
      { id: "a", receivedAt: d("2026-09-01"), status: "WON", hasQuote: true },
      { id: "b", receivedAt: d("2026-09-02"), status: "LOST", hasQuote: true },
      { id: "c", receivedAt: d("2026-09-03"), status: "NEW", hasQuote: false },
      { id: "d", receivedAt: d("2026-09-04"), status: "NEW", hasQuote: false },
    ]);
    expect(f).toMatchObject({ total: 4, quoted: 2, won: 1, quotedPct: 50, wonPct: 25 });
  });
  it("quote stats use only sent quotes and decided ones for the wait", () => {
    const q = quoteStats([
      { sentAt: d("2026-09-01"), decidedAt: d("2026-09-03"), status: "APPROVED" },
      { sentAt: d("2026-09-01"), decidedAt: d("2026-09-05"), status: "DECLINED" },
      { sentAt: d("2026-09-01"), decidedAt: null, status: "SENT" },
      { sentAt: null, decidedAt: null, status: "DRAFT" },
    ]);
    expect(q).toMatchObject({ sent: 3, approved: 1, approvalPct: 33, medianDaysToDecision: 3 });
  });
  it("billing lag medians, ignoring jobs not yet invoiced or paid", () => {
    const b = billingLag([
      { completedAt: d("2026-09-01"), assignedUserId: "t1", invoiceIssuedAt: d("2026-09-02"), invoicePaidAt: d("2026-09-12"), invoiceSubtotalCents: 1000 },
      { completedAt: d("2026-09-01"), assignedUserId: "t1", invoiceIssuedAt: d("2026-09-04"), invoicePaidAt: null, invoiceSubtotalCents: 1000 },
      { completedAt: d("2026-09-01"), assignedUserId: "t1", invoiceIssuedAt: null, invoicePaidAt: null, invoiceSubtotalCents: null },
    ]);
    expect(b).toEqual({ medianDaysToInvoice: 2, medianDaysToPaid: 10 });
  });
  it("revenue by technician sums ex-GST invoiced work, biggest first", () => {
    const row = (u: string | null, c: number | null) => ({ completedAt: d("2026-09-01"), assignedUserId: u, invoiceIssuedAt: null, invoicePaidAt: null, invoiceSubtotalCents: c });
    expect(revenueByTechnician([row("a", 100), row("b", 500), row("a", 200), row(null, 50), row("c", null)])).toEqual([
      { userId: "b", cents: 500, jobs: 1 },
      { userId: "a", cents: 300, jobs: 2 },
      { userId: null, cents: 50, jobs: 1 },
    ]);
  });
  it("monthly receipts fill empty months and ignore older payments", () => {
    const key = (x: Date) => x.toISOString().slice(0, 7);
    const m = monthlyReceipts([{ paidAt: d("2026-09-10"), amountCents: 100 }, { paidAt: d("2026-09-20"), amountCents: 50 }, { paidAt: d("2026-07-01"), amountCents: 7 }, { paidAt: d("2025-01-01"), amountCents: 999 }], key, d("2026-10-02"), 4);
    expect(m).toEqual([{ key: "2026-07", cents: 7 }, { key: "2026-08", cents: 0 }, { key: "2026-09", cents: 150 }, { key: "2026-10", cents: 0 }]);
  });
});
