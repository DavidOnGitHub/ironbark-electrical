import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { ingestScan, nextScanAfter, scanDue, scanFrequency, scanFrequencyInvalid, signScan, verifyScanSignature } from "../src/domain/it";
import { truncateAll } from "./helpers";

const DAY = 86_400_000;
const env = (frequency?: string) => ({ IT_SCAN_FREQUENCY: frequency });
const lastScanAt = async (daysAgo: number) => {
  await ingestScan({ scanId: `s-${Math.random()}`, kind: "weekly", tools: ["osv"], findings: [] });
  const row = await appDb.securityScan.findFirstOrThrow({ orderBy: { receivedAt: "desc" } });
  const at = new Date(Date.now() - daysAgo * DAY);
  await appDb.securityScan.update({ where: { id: row.id }, data: { receivedAt: at } });
  return at;
};

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("scanFrequency (IT_SCAN_FREQUENCY)", () => {
  it("reads the four choices, ignoring case and spaces", () => {
    expect(scanFrequency(env("weekly"))).toBe("weekly");
    expect(scanFrequency(env("Fortnightly"))).toBe("fortnightly");
    expect(scanFrequency(env(" MONTHLY "))).toBe("monthly");
    expect(scanFrequency(env("never"))).toBe("never");
  });

  it("is weekly when empty, missing or not understood, so a typo cannot quietly switch scanning off", () => {
    expect(scanFrequency(env())).toBe("weekly");
    expect(scanFrequency(env(""))).toBe("weekly");
    expect(scanFrequency(env("daily"))).toBe("weekly");
    expect(scanFrequency(env("nver"))).toBe("weekly");
  });

  it("reports a value that was set but not understood", () => {
    expect(scanFrequencyInvalid(env("daily"))).toBe(true);
    expect(scanFrequencyInvalid(env("monthly"))).toBe(false);
    expect(scanFrequencyInvalid(env())).toBe(false);
    expect(scanFrequencyInvalid(env(""))).toBe(false);
  });
});

describe("scanDue", () => {
  it("is due when no scan has ever run, unless scans are off", async () => {
    expect(await scanDue(new Date(), env("weekly"))).toMatchObject({ due: true });
    expect(await scanDue(new Date(), env("never"))).toMatchObject({ due: false, frequency: "never" });
  });

  it("weekly: due after seven days, not before", async () => {
    await lastScanAt(3);
    expect((await scanDue(new Date(), env("weekly"))).due).toBe(false);
    await truncateAll();
    await lastScanAt(7);
    expect((await scanDue(new Date(), env("weekly"))).due).toBe(true); // a daily check a little before the exact seven days still runs it
  });

  it("fortnightly and monthly wait longer", async () => {
    await lastScanAt(10);
    expect((await scanDue(new Date(), env("fortnightly"))).due).toBe(false);
    expect((await scanDue(new Date(), env("weekly"))).due).toBe(true); // the same scan is old enough for weekly
    await truncateAll();
    await lastScanAt(14);
    expect((await scanDue(new Date(), env("fortnightly"))).due).toBe(true);
    await truncateAll();
    await lastScanAt(20);
    expect((await scanDue(new Date(), env("monthly"))).due).toBe(false);
    await truncateAll();
    await lastScanAt(30);
    expect((await scanDue(new Date(), env("monthly"))).due).toBe(true);
  });

  it("never is never due, however old the last scan", async () => {
    await lastScanAt(400);
    expect((await scanDue(new Date(), env("never"))).due).toBe(false);
  });

  it("says when the next scan is expected", () => {
    const at = new Date("2026-11-01T03:20:00Z");
    expect(nextScanAfter("weekly", at)!.getTime()).toBeGreaterThan(at.getTime() + 6 * DAY);
    expect(nextScanAfter("never", at)).toBeNull();
    expect(nextScanAfter("weekly", null)).toBeNull();
  });
});

describe("the due check is signed like the report", () => {
  it("accepts an empty body signed with the secret and rejects a different secret", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyScanSignature({ secret: "s", timestamp: ts, signature: signScan("s", ts, ""), body: "" })).toEqual({ ok: true });
    expect(verifyScanSignature({ secret: "s", timestamp: ts, signature: signScan("other", ts, ""), body: "" })).toMatchObject({ ok: false });
  });
});
