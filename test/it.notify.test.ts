/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { notifyBudgetUsedUp, notifyConfigured, startItRequest, createItRequest, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

const ENV = { BREVO_API_KEY: "key-1", IT_NOTIFY_EMAIL: "owner@example.com", IT_NOTIFY_FROM: "it@example.com" };
const pause = { reason: "used up", budget: 50, spent: 50.2, month: new Date("2026-11-01T00:00:00Z") };
const ok = () => vi.fn(async () => new Response("{}", { status: 201 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("notifyConfigured", () => {
  it("needs the key and both addresses", () => {
    expect(notifyConfigured(ENV)).toBe(true);
    expect(notifyConfigured({ ...ENV, BREVO_API_KEY: "" })).toBe(false);
    expect(notifyConfigured({ ...ENV, IT_NOTIFY_EMAIL: "nope" })).toBe(false);
    expect(notifyConfigured({ ...ENV, IT_NOTIFY_FROM: undefined })).toBe(false);
  });
});

describe("notifyBudgetUsedUp", () => {
  it("emails the Owner through Brevo and records it", async () => {
    const fetchImpl = ok();
    expect(await notifyBudgetUsedUp(pause, ENV, { fetchImpl })).toBe(true);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("key-1");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([{ email: "owner@example.com" }]);
    expect(body.sender.email).toBe("it@example.com");
    expect(body.textContent).toContain("$50.20 spent of $50.00");
    expect(await appDb.activityEvent.count({ where: { kind: "BUDGET_NOTICE", entityId: "2026-11" } })).toBe(1);
  });
  it("sends once a month, and again in the next", async () => {
    const fetchImpl = ok();
    await notifyBudgetUsedUp(pause, ENV, { fetchImpl });
    expect(await notifyBudgetUsedUp(pause, ENV, { fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await notifyBudgetUsedUp({ ...pause, month: new Date("2026-12-01T00:00:00Z") }, ENV, { fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("sends nothing when not set up", async () => {
    const fetchImpl = ok();
    expect(await notifyBudgetUsedUp(pause, {}, { fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("records nothing when Brevo refuses or cannot be reached, so the next held request tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refuse = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(await notifyBudgetUsedUp(pause, ENV, { fetchImpl: refuse })).toBe(false);
    const down = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await notifyBudgetUsedUp(pause, ENV, { fetchImpl: down })).toBe(false);
    expect(await appDb.activityEvent.count({ where: { kind: "BUDGET_NOTICE" } })).toBe(0);
    expect(await notifyBudgetUsedUp(pause, ENV, { fetchImpl: ok() })).toBe(true);
  });
});

describe("a held request", () => {
  it("still holds when the email is not set up", async () => {
    vi.stubEnv("IT_MONTHLY_BUDGET_USD", "5");
    await appDb.itRequest.create({ data: { number: "IT-1", kind: "FEATURE", title: "t", description: "d", requestedByLabel: "t", costUsd: 6 } as any });
    const r = (await createItRequest({ kind: "FEATURE", title: "Change a label", description: "d" } as any, { actor: { type: "SYSTEM", label: "t" } } as any)).request;
    const client = { createSession: vi.fn() } as unknown as AiBuilderClient;
    expect(await startItRequest(r.id, client)).toMatchObject({ started: false });
  });
});
