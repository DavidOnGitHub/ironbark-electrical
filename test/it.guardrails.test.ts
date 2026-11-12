/* eslint-disable @typescript-eslint/no-explicit-any -- fake AI Builder client and loose session events in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import {
  acceptItChange, buildFeed, captureError, checkRevertGuard, costCapUsd, createItRequest, filesPushed, ItActionError, judgeSpike, measureChange, normalisePath, overCostCap,
  protectedFilesIn, protectedReason, resetErrorThrottle, startItRequest, syncItRequest, type AiBuilderClient,
} from "../src/domain/it";
import { truncateAll } from "./helpers";

describe("protected paths", () => {
  it.each([
    ["prisma/migrations/2026_x/migration.sql", true],
    ["prisma/schema.prisma", true],
    ["src/access.ts", true],
    ["src/guard.ts", true],
    ["proxy.ts", true],
    ["app/api/auth/[...nextauth]/route.ts", true],
    ["src/integrations/stripe.ts", true],
    ["src/integrations/stripeEvents.ts", true],
    ["app/api/stripe/webhook/route.ts", true],
    [".github/workflows/ci.yml", true],
    [".ai-builder/config.yaml", true],
    ["render.yaml", true],
    [".env.local", true],
    ["package.json", true],
    ["pnpm-lock.yaml", true],
    ["src/domain/quotes/validity.ts", false],
    ["app/quotes/page.tsx", false],
    ["test/validity.test.ts", false],
    ["docs/business/billing.md", false],
  ])("%s -> protected %s", (file, expected) => {
    expect(protectedFilesIn([file]).length > 0).toBe(expected);
  });

  it("normalises paths so a different spelling cannot slip through", () => {
    expect(normalisePath("./prisma\\migrations//x.sql")).toBe("prisma/migrations/x.sql");
    expect(protectedFilesIn(["./.github/workflows/ci.yml", "/render.yaml", "prisma\\schema.prisma"])).toEqual([".github/workflows/ci.yml", "prisma/schema.prisma", "render.yaml"]);
  });

  it("treats a path that climbs out of the project as protected", () => {
    expect(protectedFilesIn(["src/../../etc/passwd"])).toHaveLength(1);
    expect(protectedReason("src/../../etc/passwd")).toBe("Outside the project");
  });

  it("says why", () => {
    expect(protectedReason("src/access.ts")).toBe("Sign-in and permissions");
  });

  it("collects the files the assistant pushed, not merges of the base branch", () => {
    expect(filesPushed([
      { type: "commit_pushed", files: ["a.ts", "b.ts"] },
      { type: "commit_pushed", files: ["render.yaml"], reason: "base_update" },
      { type: "commit_pushed", files: ["a.ts", "c.ts"] },
      { type: "status" },
    ]).sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("cost cap", () => {
  it("defaults to $5, can be set, and ignores nonsense", () => {
    expect(costCapUsd({})).toBe(5);
    expect(costCapUsd({ IT_FIX_COST_CAP_USD: "12.5" })).toBe(12.5);
    for (const bad of ["abc", "0", "-3", ""]) expect(costCapUsd({ IT_FIX_COST_CAP_USD: bad })).toBe(5);
  });
  it("applies to automated fixes only", () => {
    expect(overCostCap("ERROR", 5.01)).toBe(true);
    expect(overCostCap("ERROR", 5)).toBe(false);
    expect(overCostCap("FINDING", 9)).toBe(true);
    expect(overCostCap("FEATURE", 50)).toBe(false);
    expect(overCostCap("ERROR", null)).toBe(false);
  });
});

describe("judgeSpike", () => {
  it("is a spike when errors triple and reach 5, or three new kinds appear", () => {
    expect(judgeSpike({ before: 1, after: 5, newErrors: 0 }).spike).toBe(true);
    expect(judgeSpike({ before: 0, after: 5, newErrors: 0 }).spike).toBe(true);
    expect(judgeSpike({ before: 10, after: 30, newErrors: 0 }).spike).toBe(true);
    expect(judgeSpike({ before: 0, after: 3, newErrors: 3 }).spike).toBe(true);
  });
  it("is not a spike for a few errors, a modest rise, or a busy baseline", () => {
    expect(judgeSpike({ before: 0, after: 4, newErrors: 2 }).spike).toBe(false);
    expect(judgeSpike({ before: 10, after: 25, newErrors: 1 }).spike).toBe(false);
    expect(judgeSpike({ before: 20, after: 20, newErrors: 0 }).spike).toBe(false);
  });
});

// ---- with a database -------------------------------------------------------------------------------------------

const SYSTEM = { actor: { type: "SYSTEM" as const, label: "t" } };
const PRIYA = { actor: { type: "USER" as const, userId: "u_priya", label: "Priya Nair" }, email: "priya@example.com" };
const aiSession = (over: Record<string, unknown> = {}) => ({ id: "s", appId: "i", intent: "bugfix", title: "t", status: "building", costUsd: 0, prUrl: null, ...over });

function fakeClient(detail: () => { session: Record<string, unknown>; events: any[] }, extra: Record<string, any> = {}) {
  let n = 0;
  const client = {
    createSession: vi.fn(async () => aiSession({ id: `g-${++n}`, status: "working" })),
    getSession: vi.fn(async (id: string) => {
      const d = detail();
      return { session: aiSession({ id, ...d.session }), events: d.events, acceptance: null };
    }),
    accept: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    ...extra,
  };
  return client as typeof client & AiBuilderClient;
}

async function started(client: AiBuilderClient, over: Record<string, unknown> = {}) {
  const { request } = await createItRequest({ kind: "ERROR", intent: "bugfix", title: "Fix", description: "d", ...over } as any, SYSTEM);
  return (await startItRequest(request.id, client)).request;
}

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("protected files on a request", () => {
  it("flags a change that touches them, tells the assistant to stay out, and blocks acceptance", async () => {
    let state: any = { session: { status: "building" }, events: [] };
    const client = fakeClient(() => state);
    const row = await started(client);
    const sent = (client.createSession as any).mock.calls[0][0];
    expect(sent.context.protectedPaths).toEqual(expect.arrayContaining(["Payments", "Database migrations and schema"]));

    state = { session: { status: "pr_open", prUrl: "https://github.com/o/r/pull/9" }, events: [{ type: "commit_pushed", files: ["src/domain/quotes/validity.ts", "prisma/migrations/x/migration.sql"] }] };
    const synced = (await syncItRequest(row.id, client))!;
    expect(synced).toMatchObject({ status: "PR_OPEN", needsDeveloper: true, protectedFiles: ["prisma/migrations/x/migration.sql"] });
    expect((await appDb.activityEvent.findMany({ where: { entityId: row.id } })).some((a) => /protected files/.test(a.summary))).toBe(true);

    const who = { actor: { type: "USER" as const, userId: "u_o", label: "Owner" }, userId: "u_o", email: "o@example.com", name: "Owner", roles: ["ADMIN"] };
    await expect(acceptItChange(row.id, "abc", who, client)).rejects.toThrow(/only a developer may approve/);
    expect(client.accept).not.toHaveBeenCalled();
  });

  it("lets an ordinary change be accepted", async () => {
    const state: any = { session: { status: "pr_open", prUrl: "u" }, events: [{ type: "commit_pushed", files: ["src/domain/quotes/validity.ts"] }] };
    const client = fakeClient(() => state);
    const row = await started(client);
    const synced = (await syncItRequest(row.id, client))!;
    expect(synced.needsDeveloper).toBe(false);
    const who = { actor: { type: "USER" as const, userId: "u_o", label: "Owner" }, userId: "u_o", email: "o@example.com", name: "Owner", roles: ["ADMIN"] };
    await acceptItChange(row.id, "abc", who, client);
    expect(client.accept).toHaveBeenCalled();
  });

  it("shows in the feed", () => {
    const feed = buildFeed({
      error: null,
      reopenedAt: [],
      attempts: [{ request: { number: "IT-1", status: "PR_OPEN", createdAt: new Date(), updatedAt: new Date(), mergedAt: null, deployError: null, prUrl: null, previewUrl: null, needsDeveloper: true, protectedFiles: ["src/access.ts"], lastError: null }, events: [] }],
      fallbackTitle: "x",
    });
    expect(feed.map((f) => f.text)).toEqual(expect.arrayContaining(["A developer must review it first", "Waiting for a developer to review it"]));
  });
});

describe("cost cap on a request", () => {
  it("stops an automated fix that has spent too much", async () => {
    const state: any = { session: { status: "building", costUsd: 7.25 }, events: [] };
    const client = fakeClient(() => state);
    const row = await started(client);
    const out = (await syncItRequest(row.id, client))!;
    expect(client.cancel).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "FAILED", costUsd: 7.25 });
    expect(out.lastError).toMatch(/Stopped: this fix has cost \$7\.25, over the \$5\.00 limit/);
  });

  it("does not stop one that is within the cap, one a person asked for, or one already waiting on a person", async () => {
    for (const [kind, cost, status] of [["ERROR", 4.99, "building"], ["FEATURE", 40, "building"], ["ERROR", 40, "pr_open"]] as const) {
      await truncateAll();
      const state: any = { session: { status, costUsd: cost, prUrl: status === "pr_open" ? "u" : null }, events: [] };
      const client = fakeClient(() => state);
      const row = await started(client, { kind, intent: kind === "FEATURE" ? "feature" : "bugfix" });
      const out = (await syncItRequest(row.id, client))!;
      expect(client.cancel).not.toHaveBeenCalled();
      expect(out.status).not.toBe("FAILED");
    }
  });

  it("keeps trying to stop it when the cancel fails, and says so", async () => {
    const state: any = { session: { status: "building", costUsd: 9 }, events: [] };
    const client = fakeClient(() => state, { cancel: vi.fn(async () => { throw new Error("builder busy"); }) });
    const row = await started(client);
    const out = (await syncItRequest(row.id, client))!;
    expect(out.status).not.toBe("FAILED");
    expect(out.lastError).toMatch(/could not be stopped: builder busy/);
  });
});

describe("revert guard", () => {
  const T0 = new Date("2026-11-06T10:00:00Z");
  const min = (m: number) => new Date(T0.getTime() + m * 60_000);
  const env = { IT_AUTOFIX: "on" };

  /** A live change at T0 (the fix for `fixes`, when given) plus errors in the buckets before and after. */
  async function liveChange(opts: { before?: number; after?: number; sourceId?: string | null; sourceType?: string | null } = {}) {
    const { request } = await createItRequest({ kind: "FEATURE", title: "Rename panel", description: "d", ...(opts.sourceType ? { sourceType: opts.sourceType, sourceId: opts.sourceId ?? "x" } : {}) }, SYSTEM);
    await appDb.itRequest.update({ where: { id: request.id }, data: { status: "LIVE", liveAt: T0, prUrl: "https://github.com/o/r/pull/3" } });
    const other = (await captureError(new TypeError("unrelated failure A"), { source: "request", route: "/jobs", now: min(-60) })).id!;
    await appDb.errorBucket.deleteMany();
    if (opts.before) await appDb.errorBucket.create({ data: { errorId: other, startsAt: min(-15), count: opts.before } });
    if (opts.after) await appDb.errorBucket.create({ data: { errorId: other, startsAt: min(10), count: opts.after } });
    return { request, other };
  }

  it("measures errors before and after, ignoring the error the change was meant to fix", async () => {
    const { other } = await liveChange({ before: 1, after: 2 });
    await appDb.errorBucket.create({ data: { errorId: "fixed-one", startsAt: min(5), count: 50 } });
    expect(await measureChange(T0, "fixed-one")).toMatchObject({ before: 1, after: 2, spike: false });
    expect((await measureChange(T0, null)).after).toBe(52);
    expect(other).toBeTruthy();
  });

  it("does nothing before the 30 minutes are up", async () => {
    await liveChange({ after: 20 });
    expect(await checkRevertGuard(fakeClient(() => ({ session: {}, events: [] })), min(20), env)).toEqual({ checked: 0, spikes: 0, reverts: 0 });
  });

  it("is quiet when errors did not rise, and only looks once", async () => {
    const { request } = await liveChange({ before: 3, after: 4 });
    const client = fakeClient(() => ({ session: {}, events: [] }));
    expect(await checkRevertGuard(client, min(31), env)).toEqual({ checked: 1, spikes: 0, reverts: 0 });
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: request.id } })).revertCheckedAt).not.toBeNull();
    expect(await checkRevertGuard(client, min(40), env)).toEqual({ checked: 0, spikes: 0, reverts: 0 });
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("prepares a revert request on a spike, which still needs a person to accept it", async () => {
    const { request } = await liveChange({ before: 0, after: 12 });
    const client = fakeClient(() => ({ session: {}, events: [] }));
    expect(await checkRevertGuard(client, min(31), env)).toEqual({ checked: 1, spikes: 1, reverts: 1 });
    const sent = (client.createSession as any).mock.calls[0][0];
    expect(sent.intent).toBe("bugfix");
    expect(sent.text).toMatch(/reverts exactly that change/);
    expect(sent.text).toMatch(/Do not try to fix it forward/);
    const revert = await appDb.itRequest.findFirstOrThrow({ where: { sourceType: "revert" } });
    expect(revert).toMatchObject({ sourceId: request.id, kind: "ERROR" });
    expect(revert.status).not.toBe("MERGED");
    expect(client.accept).not.toHaveBeenCalled();
  });

  it("only records the spike when auto-fix is off", async () => {
    await liveChange({ after: 12 });
    const client = fakeClient(() => ({ session: {}, events: [] }));
    expect(await checkRevertGuard(client, min(31), {})).toEqual({ checked: 1, spikes: 1, reverts: 0 });
    expect(client.createSession).not.toHaveBeenCalled();
    expect((await appDb.activityEvent.findMany()).some((a) => /errors rose after going live/.test(a.summary))).toBe(true);
  });

  it("never reverts a revert", async () => {
    await liveChange({ after: 30, sourceType: "revert", sourceId: "orig" });
    const client = fakeClient(() => ({ session: {}, events: [] }));
    expect(await checkRevertGuard(client, min(31), env)).toEqual({ checked: 0, spikes: 0, reverts: 0 });
  });

  it("does not blame a fix for the error it was meant to fix", async () => {
    const errId = (await captureError(new TypeError("Cannot read properties of null (reading 'a')"), { source: "request", route: "/quotes", now: min(-5) })).id!;
    const { request } = await createItRequest({ kind: "ERROR", intent: "bugfix", title: "Fix", description: "d", sourceType: "error", sourceId: errId }, SYSTEM);
    await appDb.itRequest.update({ where: { id: request.id }, data: { status: "LIVE", liveAt: T0 } });
    await appDb.errorBucket.deleteMany();
    await appDb.errorBucket.create({ data: { errorId: errId, startsAt: min(10), count: 40 } }); // the fixed error still noisy from old instances
    const client = fakeClient(() => ({ session: {}, events: [] }));
    expect(await checkRevertGuard(client, min(31), env)).toEqual({ checked: 1, spikes: 0, reverts: 0 });
  });

  it("captured errors land in 5 minute buckets", async () => {
    const t = new Date("2026-11-06T10:07:00Z");
    const id = (await captureError(new TypeError("bucket test failure"), { source: "request", route: "/x", now: t })).id!;
    resetErrorThrottle();
    await captureError(new TypeError("bucket test failure"), { source: "request", route: "/x", now: new Date(t.getTime() + 60_000) });
    const buckets = await appDb.errorBucket.findMany({ where: { errorId: id } });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ count: 2, startsAt: new Date("2026-11-06T10:05:00Z") });
  });
});

it("a person-asked request is unaffected by guardrail fields", async () => {
  const { request } = await createItRequest({ kind: "FEATURE", title: "T", description: "d" }, PRIYA);
  expect(request).toMatchObject({ needsDeveloper: false, protectedFiles: [], liveAt: null, revertCheckedAt: null });
  expect(ItActionError).toBeTruthy();
});
