import { describe, expect, it } from "vitest";
import { computeTotals, DEPOSIT_THRESHOLD_CENTS, effectiveQuoteStatus, lineTotalCents, materialPriceCents } from "../src/domain/quotes/calc";
import { canMoveJob, isActiveJob, JOB_STATUS_ORDER, JOB_TRANSITIONS, technicianCanMoveJob, windowsOverlap } from "../src/domain/jobs/status";
import { centsToInput, formatMoney, parseMoney } from "../src/lib/money";
import { addDaysKey, dateToSydneyLocal, dayKey, sydneyLocalToDate, weekDayKeys, weekStartKey } from "../src/lib/tz";

describe("quote totals", () => {
  it("rounds each line half up and adds GST once on the subtotal", () => {
    expect(lineTotalCents(1.5, 8500)).toBe(12750);
    expect(lineTotalCents(0.33, 1000)).toBe(330);
    const t = computeTotals([{ quantity: 2, unitPriceCents: 9500 }, { quantity: 1, unitPriceCents: 4500 }]);
    expect(t).toMatchObject({ subtotalCents: 23500, gstCents: 2350, totalCents: 25850, depositRequired: false, depositCents: 0 });
  });
  it("rounds GST half up to the cent", () => {
    expect(computeTotals([{ quantity: 1, unitPriceCents: 1005 }]).gstCents).toBe(101); // 100.5 -> 101
    expect(computeTotals([{ quantity: 1, unitPriceCents: 1004 }]).gstCents).toBe(100);
  });
  it("requires a 30% deposit only when the total incl GST is OVER $1,500", () => {
    // total exactly 1,500.00 -> no deposit; 1 cent over -> deposit
    const atThreshold = computeTotals([{ quantity: 1, unitPriceCents: 136364 }]); // 1363.64 + 136.36 = 1500.00
    expect(atThreshold.totalCents).toBe(DEPOSIT_THRESHOLD_CENTS);
    expect(atThreshold.depositRequired).toBe(false);
    const over = computeTotals([{ quantity: 1, unitPriceCents: 150000 }]); // 1500 + 150 = 1650
    expect(over).toMatchObject({ totalCents: 165000, depositRequired: true, depositPct: 30, depositCents: 49500 });
  });
  it("handles an empty quote", () => {
    expect(computeTotals([])).toMatchObject({ subtotalCents: 0, gstCents: 0, totalCents: 0, depositRequired: false });
  });
  it("prices materials from cost and markup", () => {
    expect(materialPriceCents(1000, 40)).toBe(1400);
    expect(materialPriceCents(333, 50)).toBe(500); // 499.5 -> 500
  });
});

describe("quote validity", () => {
  const until = new Date("2026-10-15T00:00:00Z");
  it("reads a sent quote past its date as expired", () => {
    expect(effectiveQuoteStatus("SENT", until, new Date("2026-10-16T00:00:00Z"))).toBe("EXPIRED");
    expect(effectiveQuoteStatus("SENT", until, new Date("2026-10-14T00:00:00Z"))).toBe("SENT");
  });
  it("never changes other statuses", () => {
    for (const s of ["DRAFT", "APPROVED", "DECLINED"] as const) expect(effectiveQuoteStatus(s, until, new Date("2027-01-01"))).toBe(s);
  });
});

describe("job status rules", () => {
  it("allows the normal flow", () => {
    expect(canMoveJob("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canMoveJob("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canMoveJob("COMPLETED", "INVOICED")).toBe(true);
    expect(canMoveJob("INVOICED", "PAID")).toBe(true);
  });
  it("blocks skipping and going back out of completed", () => {
    expect(canMoveJob("UNSCHEDULED", "COMPLETED")).toBe(false);
    expect(canMoveJob("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(JOB_TRANSITIONS.PAID).toEqual([]);
  });
  it("limits technicians to field moves on their own work", () => {
    expect(technicianCanMoveJob("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(technicianCanMoveJob("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(technicianCanMoveJob("COMPLETED", "INVOICED")).toBe(false);
    expect(technicianCanMoveJob("UNSCHEDULED", "SCHEDULED")).toBe(false);
  });
  it("lists every status once and knows the active ones", () => {
    expect(new Set(JOB_STATUS_ORDER).size).toBe(7);
    expect(isActiveJob("ON_HOLD")).toBe(true);
    expect(isActiveJob("COMPLETED")).toBe(false);
  });
  it("detects overlapping windows but not back-to-back ones", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 5, h));
    expect(windowsOverlap(t(9), t(11), t(10), t(12))).toBe(true);
    expect(windowsOverlap(t(9), t(11), t(11), t(13))).toBe(false);
    expect(windowsOverlap(t(9), t(17), t(12), t(13))).toBe(true);
  });
});

describe("money", () => {
  it("formats and parses", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(parseMoney("$1,234.5")).toBe(123450);
    expect(parseMoney("85")).toBe(8500);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(centsToInput(8550)).toBe("85.50");
    expect(centsToInput(null)).toBe("");
  });
});

describe("Sydney time", () => {
  it("converts wall time to the right instant in summer (AEDT, +11) and winter (AEST, +10)", () => {
    expect(sydneyLocalToDate("2026-12-01T09:00")!.toISOString()).toBe("2026-11-30T22:00:00.000Z");
    expect(sydneyLocalToDate("2026-06-01T09:00")!.toISOString()).toBe("2026-05-31T23:00:00.000Z");
  });
  it("round-trips and handles the day boundary", () => {
    const d = sydneyLocalToDate("2026-10-05T07:30")!;
    expect(dateToSydneyLocal(d)).toBe("2026-10-05T07:30");
    expect(dayKey(sydneyLocalToDate("2026-10-05T23:30")!)).toBe("2026-10-05");
  });
  it("rejects malformed input", () => {
    expect(sydneyLocalToDate("2026-10-05 09:00")).toBeNull();
    expect(sydneyLocalToDate("nope")).toBeNull();
  });
  it("finds the Monday of a week and lists seven days", () => {
    expect(weekStartKey("2026-10-01")).toBe("2026-09-28"); // a Thursday
    expect(weekStartKey("2026-09-28")).toBe("2026-09-28");
    expect(weekStartKey("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week before
    expect(weekDayKeys("2026-09-28")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});
