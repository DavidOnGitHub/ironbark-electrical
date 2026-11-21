/* eslint-disable @typescript-eslint/no-explicit-any -- AI Builder replies are dynamic JSON in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { approveItSpec, createItRequest, creditBalance, creditPause, creditsFor, creditsUsedInMonth, featureCreditsPerMonth, startItRequest, type AiBuilderClient, type Responder } from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Priya" }, userId: "u1", email: "priya@example.com", name: "Priya Nair", roles: ["ADMIN"] };
const NOW = new Date("2026-11-17T10:00:00Z");

const spec = (version: number, size?: string) => ({
  type: "spec_ready",
  version,
  spec: { title: "Add a column", summary: "Show the suburb", acceptanceCriteria: [{ id: "AC-1", text: "Shows it" }], ...(size ? { estimate: { size, reason: "One list changes." } } : {}) },
});

function fake(events: any[]) {
  const client = {
    createSession: vi.fn(async () => ({ id: "s9", appId: "a", intent: "feature", title: "T", status: "working", costUsd: 0, prUrl: null })),
    getSession: vi.fn(async () => ({ session: { id: "s1", appId: "a", intent: "feature", title: "T", status: "spec_review", costUsd: 0, prUrl: null }, events, acceptance: null })),
    approveSpec: vi.fn(),
    sendMessage: vi.fn(),
    requestChanges: vi.fn(),
    accept: vi.fn(),
    cancel: vi.fn(),
  };
  return client as typeof client & AiBuilderClient;
}

let n = 0;
/** A change request whose plan waits for approval. */
async function inReview(kind: "FEATURE" | "ERROR" = "FEATURE") {
  const { request } = await createItRequest({ kind, title: `Request ${++n}`, description: "d" }, { actor: owner.actor, email: owner.email });
  return appDb.itRequest.update({ where: { id: request.id }, data: { sessionId: `s-${n}`, status: "SPEC_REVIEW" } });
}
/** A request charged some credits on a given day. */
async function charged(credits: number, at: Date, status = "BUILDING") {
  const r = await inReview();
  return appDb.itRequest.update({ where: { id: r.id }, data: { credits, creditsChargedAt: at, estimateSize: "s", status: status as any } });
}

beforeEach(async () => {
  await truncateAll();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("the price list and the allowance", () => {
  it("prices each size and leaves xl to a developer", () => {
    expect(["xs", "s", "m", "l", "xl"].map((s) => creditsFor(s as any))).toEqual([1, 2, 4, 8, null]);
  });
  it("reads the allowance, with no limit when unset or unusable", () => {
    expect(featureCreditsPerMonth({})).toBeNull();
    expect(featureCreditsPerMonth({ IT_FEATURE_CREDITS_PER_MONTH: "abc" })).toBeNull();
    expect(featureCreditsPerMonth({ IT_FEATURE_CREDITS_PER_MONTH: "2.5" })).toBeNull();
    expect(featureCreditsPerMonth({ IT_FEATURE_CREDITS_PER_MONTH: "4" })).toBe(4);
    expect(featureCreditsPerMonth({ IT_FEATURE_CREDITS_PER_MONTH: "0" })).toBe(0);
  });
  it("counts credits in the month the plan was approved, and gives back closed and failed ones", async () => {
    await charged(2, new Date("2026-11-02T00:00:00Z"));
    await charged(1, new Date("2026-11-30T23:59:59Z"), "LIVE");
    await charged(4, new Date("2026-11-10T00:00:00Z"), "CLOSED");
    await charged(8, new Date("2026-11-11T00:00:00Z"), "FAILED");
    await charged(8, new Date("2026-10-31T23:59:59Z"));
    expect(await creditsUsedInMonth(NOW)).toBe(3);
    expect(await creditBalance({ IT_FEATURE_CREDITS_PER_MONTH: "4" }, NOW)).toEqual({ allowance: 4, used: 3, left: 1 });
  });
});

describe("approving a change request's plan", () => {
  it("charges the price of the approved plan and records it", async () => {
    vi.stubEnv("IT_FEATURE_CREDITS_PER_MONTH", "4");
    const row = await inReview();
    const client = fake([spec(1, "m"), spec(2, "s")]);
    await approveItSpec(row.id, 2, owner, client);
    expect(client.approveSpec).toHaveBeenCalledWith(row.sessionId, 2, expect.objectContaining({ role: "approver" }));
    const after = await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ credits: 2, estimateSize: "s" });
    expect(after.creditsChargedAt).toBeInstanceOf(Date);
  });

  it("refuses when the month's credits do not cover it, and charges nothing", async () => {
    vi.stubEnv("IT_FEATURE_CREDITS_PER_MONTH", "4");
    await charged(3, new Date());
    const row = await inReview();
    const client = fake([spec(1, "s")]);
    await expect(approveItSpec(row.id, 1, owner, client)).rejects.toThrow(/costs 2 credits \(about \$20\), but only 1 of this month's 4 credits is left/);
    expect(client.approveSpec).not.toHaveBeenCalled();
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } })).credits).toBeNull();
  });

  it("refuses a plan too large to price, a plan with no price, and a plan that is not the latest", async () => {
    const row = await inReview();
    await expect(approveItSpec(row.id, 1, owner, fake([spec(1, "xl")]))).rejects.toThrow(/developer needs to look at it/);
    await expect(approveItSpec(row.id, 1, owner, fake([spec(1)]))).rejects.toThrow(/no price yet/);
    await expect(approveItSpec(row.id, 1, owner, fake([spec(1, "s"), spec(2, "xs")]))).rejects.toThrow(/plan has changed/);
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } })).credits).toBeNull();
  });

  it("lets only one of two approvals at once spend the last credits", async () => {
    vi.stubEnv("IT_FEATURE_CREDITS_PER_MONTH", "2");
    const a = await inReview();
    const b = await inReview();
    const results = await Promise.allSettled([approveItSpec(a.id, 1, owner, fake([spec(1, "s")])), approveItSpec(b.id, 1, owner, fake([spec(1, "s")]))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await creditsUsedInMonth(new Date())).toBe(2);
  });

  it("does not price error fixes", async () => {
    vi.stubEnv("IT_FEATURE_CREDITS_PER_MONTH", "0");
    const row = await inReview("ERROR");
    const client = fake([]);
    await approveItSpec(row.id, 1, owner, client);
    expect(client.approveSpec).toHaveBeenCalled();
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } })).credits).toBeNull();
  });
});

describe("starting a change request", () => {
  it("waits while none of the month's credits are left, whatever the fix budget", async () => {
    vi.stubEnv("IT_FEATURE_CREDITS_PER_MONTH", "2");
    vi.stubEnv("IT_FIX_MONTHLY_BUDGET_USD", "1");
    await appDb.itRequest.create({ data: { number: "IT-9", kind: "ERROR", title: "t", description: "d", requestedByLabel: "t", costUsd: 5 } as any });
    const { request } = await createItRequest({ kind: "FEATURE", title: "New", description: "d" }, { actor: owner.actor });
    const client = fake([]);
    await charged(1, new Date());
    // One credit is left: the fix budget being used up does not hold a change request back.
    expect(await creditPause()).toBeNull();
    expect((await startItRequest(request.id, client)).started).toBe(true);

    const { request: next } = await createItRequest({ kind: "FEATURE", title: "Another", description: "d" }, { actor: owner.actor });
    await charged(1, new Date());
    expect(await startItRequest(next.id, client)).toMatchObject({ started: false, reason: expect.stringContaining("credits are used up") });
  });
});
