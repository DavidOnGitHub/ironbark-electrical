import { describe, expect, it } from "vitest";
import { aggregate, bucketOf, previousPeriod, resolvePeriod, runReport, type Row } from "../src/domain/reports/query";

// Tuesday 20 Oct 2026, 10:00 Sydney.
const NOW = new Date("2026-10-19T23:00:00Z");
const row = (at: string, amountCents: number, fields: Record<string, string> = {}): Row => ({ at: new Date(at), amountCents, fields });

describe("resolvePeriod", () => {
  it("runs weeks Monday to Sunday in Sydney time", () => {
    expect(resolvePeriod("thisWeek", NOW)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(resolvePeriod("lastWeek", NOW)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("resolves months, and rolling windows ending today", () => {
    expect(resolvePeriod("thisMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod("lastMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("last7Days", NOW)).toEqual({ from: "2026-10-14", to: "2026-10-20" });
  });
});

describe("previousPeriod", () => {
  it("is the same length straight before, or the whole earlier month", () => {
    expect(previousPeriod({ from: "2026-10-19", to: "2026-10-25" })).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod({ from: "2026-01-01", to: "2026-01-31" })).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("aggregate", () => {
  const rows = [row("2026-10-19T23:30:00Z", 1000, { status: "PAID" }), row("2026-10-21T01:00:00Z", 2500, { status: "SENT" }), row("2026-10-21T02:00:00Z", 500, { status: "PAID" })];
  it("buckets by Sydney day (not UTC), week and month", () => {
    expect(bucketOf(rows[0]!, "day")).toBe("2026-10-20");
    expect(bucketOf(rows[0]!, "week")).toBe("2026-10-19");
    expect(bucketOf(rows[0]!, "month")).toBe("2026-10");
  });
  it("totals, and orders field groups biggest first and time groups oldest first", () => {
    const byStatus = aggregate(rows, "status");
    expect(byStatus).toMatchObject({ count: 3, totalCents: 4000 });
    expect(byStatus.groups.map((g) => g.key)).toEqual(["SENT", "PAID"]);
    expect(aggregate(rows, "day").groups.map((g) => g.key)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(aggregate(rows).groups).toEqual([]);
  });
});

describe("runReport", () => {
  it("rejects fields a dataset does not have, before touching the database", async () => {
    await expect(runReport({ dataset: "payments", groupBy: "technician" }, NOW)).rejects.toThrow(/grouped by/);
    await expect(runReport({ dataset: "quotes", dateField: "paidAt" }, NOW)).rejects.toThrow(/dated by/);
    await expect(runReport({ dataset: "jobs", from: "2026-10-01" }, NOW)).rejects.toThrow(/both from and to/);
  });
  it("compares this week with last week from the real tables", async () => {
    const r = (await runReport({ dataset: "enquiries", period: "thisWeek", compareWithPrevious: true, groupBy: "status" }, NOW)) as { period: unknown; previous: { period: unknown }; change: { count: string } };
    expect(r.period).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(r.previous.period).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(typeof r.change.count).toBe("string");
  });
});
