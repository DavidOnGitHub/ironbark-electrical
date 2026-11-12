import { describe, expect, it } from "vitest";
import { balanceDueCents, chaseStage, daysOverdue, effectiveInvoiceStatus, invoiceTotals } from "../src/domain/invoicing/calc";

describe("invoice totals", () => {
  it("adds GST once on the subtotal and credits the deposit against the total incl GST", () => {
    const t = invoiceTotals([{ quantity: 1, unitPriceCents: 150000 }, { quantity: 2, unitPriceCents: 9500 }], 49_500);
    expect(t).toEqual({ subtotalCents: 169000, gstCents: 16900, totalCents: 185900, creditCents: 49500 });
    expect(balanceDueCents(t.totalCents, t.creditCents, 0)).toBe(136_400);
  });
  it("never credits more than the total (the balance cannot go negative)", () => {
    const t = invoiceTotals([{ quantity: 1, unitPriceCents: 10000 }], 50_000);
    expect(t.creditCents).toBe(11000);
    expect(balanceDueCents(t.totalCents, t.creditCents, 0)).toBe(0);
  });
  it("ignores a negative deposit", () => {
    expect(invoiceTotals([{ quantity: 1, unitPriceCents: 10000 }], -5).creditCents).toBe(0);
  });
  it("subtracts payments and floors at zero", () => {
    expect(balanceDueCents(11000, 0, 4000)).toBe(7000);
    expect(balanceDueCents(11000, 0, 11000)).toBe(0);
    expect(balanceDueCents(11000, 0, 12000)).toBe(0);
  });
});

describe("overdue", () => {
  const due = new Date("2026-10-10T00:00:00Z");
  it("only an issued invoice with a balance past its due date is overdue", () => {
    const after = new Date("2026-10-12T00:00:00Z");
    expect(effectiveInvoiceStatus("SENT", due, 5000, after)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus("PARTIALLY_PAID", due, 100, after)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus("SENT", due, 5000, new Date("2026-10-09T00:00:00Z"))).toBe("SENT");
    expect(effectiveInvoiceStatus("SENT", due, 0, after)).toBe("SENT"); // nothing owing
    for (const s of ["DRAFT", "PAID", "VOID"] as const) expect(effectiveInvoiceStatus(s, due, 5000, after)).toBe(s);
  });
  it("counts whole days past the due date", () => {
    expect(daysOverdue(due, new Date("2026-10-10T12:00:00Z"))).toBe(0);
    expect(daysOverdue(due, new Date("2026-10-11T00:00:00Z"))).toBe(1);
    expect(daysOverdue(due, new Date("2026-10-09T00:00:00Z"))).toBe(0);
  });
  it("AC-1: a missing due date is 0 days overdue and does not throw (BR-INV-11)", () => {
    expect(daysOverdue(null, new Date("2026-10-12T00:00:00Z"))).toBe(0);
  });
  it("AC-2: an issued invoice with no due date keeps its stored status, never OVERDUE (BR-INV-10)", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    for (const s of ["SENT", "PARTIALLY_PAID"] as const) expect(effectiveInvoiceStatus(s, null, 5000, now)).toBe(s);
  });
  it("walks the chasing cadence: day 1 email, day 7 call, day 14 formal notice, day 30 escalate", () => {
    expect(chaseStage(0)).toEqual({ stage: 0, action: "Not overdue" });
    expect(chaseStage(1).stage).toBe(1);
    expect(chaseStage(6).stage).toBe(1);
    expect(chaseStage(7).stage).toBe(7);
    expect(chaseStage(13).stage).toBe(7);
    expect(chaseStage(14).stage).toBe(14);
    expect(chaseStage(29).stage).toBe(14);
    expect(chaseStage(30)).toEqual({ stage: 30, action: "Escalate to the owner" });
    expect(chaseStage(90).stage).toBe(30);
  });
});
