/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { budgetPause, createItRequest, fixBudgetUsd, startItRequest, usageForMonth, usageHistory, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

const NOW = new Date("2026-11-17T10:00:00Z");
const fakeClient = () => ({ createSession: vi.fn(async () => ({ id: "s1", appId: "a", intent: "feature", title: "T", status: "working", costUsd: 0, prUrl: null })) }) as unknown as AiBuilderClient & { createSession: ReturnType<typeof vi.fn> };
async function spend(kind: "FEATURE" | "ERROR" | "FINDING", costUsd: number, createdAt: Date, extra: Record<string, unknown> = {}) {
  const n = await appDb.itRequest.count();
  await appDb.itRequest.create({ data: { number: `IT-${2000 + n}`, kind, title: "t", description: "d", requestedByLabel: "t", costUsd, createdAt, ...extra } as any });
}

describe("fixBudgetUsd", () => {
  it("is null unless a positive number is set", () => {
    expect(fixBudgetUsd({})).toBeNull();
    expect(fixBudgetUsd({ IT_FIX_MONTHLY_BUDGET_USD: "" })).toBeNull();
    expect(fixBudgetUsd({ IT_FIX_MONTHLY_BUDGET_USD: "abc" })).toBeNull();
    expect(fixBudgetUsd({ IT_FIX_MONTHLY_BUDGET_USD: "0" })).toBeNull();
    expect(fixBudgetUsd({ IT_FIX_MONTHLY_BUDGET_USD: "50" })).toBe(50);
  });
});

describe("usage", () => {
  it("adds up the month by kind, counts only fixes as fix spend, and leaves other months out", async () => {
    await spend("FEATURE", 3, new Date("2026-11-02T00:00:00Z"));
    await spend("ERROR", 1.5, new Date("2026-11-16T23:59:00Z"));
    await spend("FINDING", 2, new Date("2026-11-30T23:59:59Z"));
    await spend("FEATURE", 99, new Date("2026-10-31T23:59:59Z"));
    await spend("FEATURE", 99, new Date("2026-12-01T00:00:00Z"));
    const u = await usageForMonth(NOW);
    expect(u.fixSpent).toBe(3.5);
    expect(u.fixRequests).toBe(2);
    expect(u.credits).toBe(0);
    expect(u.byKind).toEqual([{ kind: "FEATURE", spent: 3, requests: 1 }, { kind: "ERROR", spent: 1.5, requests: 1 }, { kind: "FINDING", spent: 2, requests: 1 }]);
  });
  it("lists this month and the ones before, newest first, across a year end", async () => {
    await spend("ERROR", 4, new Date("2026-12-10T00:00:00Z"));
    await spend("FINDING", 2, new Date("2026-11-10T00:00:00Z"));
    await spend("FEATURE", 1, new Date("2026-11-10T00:00:00Z"), { credits: 2, creditsChargedAt: new Date("2026-11-10T00:00:00Z"), status: "LIVE" });
    const h = await usageHistory(3, new Date("2026-12-20T00:00:00Z"));
    expect(h.map((m) => m.fixSpent)).toEqual([4, 2, 0]);
    expect(h.map((m) => m.credits)).toEqual([0, 2, 0]);
    expect((await usageHistory(3, new Date("2027-01-05T00:00:00Z"))).map((m) => m.month.toISOString().slice(0, 7))).toEqual(["2027-01", "2026-12", "2026-11"]);
  });
});

describe("budgetPause", () => {
  it("never pauses without a budget, and only once the month's spend on fixes reaches it", async () => {
    await spend("ERROR", 6, NOW);
    await spend("FINDING", 4, NOW);
    await spend("FEATURE", 50, NOW);
    expect(await budgetPause({}, NOW)).toBeNull();
    expect(await budgetPause({ IT_FIX_MONTHLY_BUDGET_USD: "10.01" }, NOW)).toBeNull();
    expect((await budgetPause({ IT_FIX_MONTHLY_BUDGET_USD: "10" }, NOW))?.reason).toContain("used up");
  });
  it("starts again in a new month", async () => {
    await spend("ERROR", 10, NOW);
    expect(await budgetPause({ IT_FIX_MONTHLY_BUDGET_USD: "10" }, new Date("2026-12-01T00:00:00Z"))).toBeNull();
  });
});

describe("starting a request under a budget", () => {
  const made = async (extra: Record<string, unknown> = {}) => (await createItRequest({ kind: "FEATURE", title: "Change a label", description: "d", ...extra } as any, { actor: { type: "SYSTEM", label: "t" } } as any)).request;

  it("holds a new fix back, without a session, once the budget is used up, and starts it when there is room", async () => {
    vi.stubEnv("IT_FIX_MONTHLY_BUDGET_USD", "5");
    await spend("ERROR", 5, new Date());
    const client = fakeClient();
    const r = await made({ kind: "ERROR" });
    const held = await startItRequest(r.id, client);
    expect(held).toMatchObject({ started: false, reason: expect.stringContaining("used up") });
    expect(client.createSession).not.toHaveBeenCalled();
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: r.id } })).sessionId).toBeNull();
    vi.stubEnv("IT_FIX_MONTHLY_BUDGET_USD", "50");
    expect((await startItRequest(r.id, client)).started).toBe(true);
  });

  it("does not hold back a change request: those are paid in credits", async () => {
    vi.stubEnv("IT_FIX_MONTHLY_BUDGET_USD", "5");
    await spend("ERROR", 5, new Date());
    expect((await startItRequest((await made()).id, fakeClient())).started).toBe(true);
  });

  it("never holds back a revert", async () => {
    vi.stubEnv("IT_FIX_MONTHLY_BUDGET_USD", "5");
    await spend("ERROR", 50, new Date());
    const client = fakeClient();
    const r = await made({ kind: "ERROR", sourceType: "revert", sourceId: "x" });
    expect((await startItRequest(r.id, client)).started).toBe(true);
  });
});
