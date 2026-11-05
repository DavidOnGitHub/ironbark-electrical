/* eslint-disable @typescript-eslint/no-explicit-any -- step outputs are dynamic JSON in these tests */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runStep, TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { registerIronbark } from "../src/steps/register";
import { AiBuilderError, createItRequest, getItRequest, listItRequests, startItRequest, submitItRequest, syncItRequest, syncOpenItRequests, type AiBuilderClient } from "../src/domain/it";
import { listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const by = { actor: priya, email: "Priya@Example.com" };
const auto: Actor = { type: "WORKFLOW", label: "Automation" };

const aiSession = (over: Record<string, unknown> = {}) => ({ id: "sess-1", appId: "ironbark", intent: "feature", title: "T", status: "working", costUsd: 0, prUrl: null, ...over });

/** Session ids are unique across fake clients, as they are across real sessions. */
let sessionCounter = 0;

/** A fake AI Builder. Each test sets what getSession answers. */
function fakeClient(over: Partial<Record<keyof AiBuilderClient, any>> = {}) {
  const client = {
    createSession: vi.fn(async () => aiSession({ id: `sess-${++sessionCounter}` })),
    getSession: vi.fn(async (id: string) => ({ session: aiSession({ id }), events: [], acceptance: null })),
    sendMessage: vi.fn(),
    approveSpec: vi.fn(),
    requestChanges: vi.fn(),
    accept: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
  return client as typeof client & AiBuilderClient;
}
const detail = (id: string, status: string, extra: { prUrl?: string | null; events?: any[]; costUsd?: number } = {}) => ({
  session: aiSession({ id, status, prUrl: extra.prUrl ?? null, costUsd: extra.costUsd ?? 0 }),
  events: extra.events ?? [],
  acceptance: null,
});

const feature = { kind: "FEATURE" as const, title: "Rename the dashboard panel", description: "Call it Recent activities" };
const error = { kind: "ERROR" as const, title: "TypeError on /quotes/[id]", description: "Cannot read properties of undefined", sourceType: "error", sourceId: "fp-123", context: { route: "/quotes/1", stack: "at foo" } };

beforeAll(() => registerIronbark());
beforeEach(async () => {
  sessionCounter = 0;
  await truncateAll();
});
afterAll(() => appDb.$disconnect());

describe("opening requests", () => {
  it("numbers requests from IT-1001 and writes the timeline", async () => {
    const a = await createItRequest(feature, by);
    const b = await createItRequest({ ...feature, title: "Another" }, by);
    expect([a.request.number, b.request.number]).toEqual(["IT-1001", "IT-1002"]);
    expect(a.request).toMatchObject({ status: "SUBMITTED", requestedByLabel: "Priya Nair", requestedByUserId: "u_priya", requestedByEmail: "priya@example.com" });
    const events = await listEntityTimeline("itRequest", a.request.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "CREATED", actorType: "USER", summary: "IT-1001 opened: Rename the dashboard panel" });
  });

  it("validates input", async () => {
    await expect(createItRequest({ ...feature, title: "  " }, by)).rejects.toThrow(/title/i);
    await expect(createItRequest({ ...feature, description: "" }, by)).rejects.toThrow();
    await expect(createItRequest({ ...feature, kind: "NOPE" as never }, by)).rejects.toThrow();
  });

  it("reuses the open request for the same source, and opens a new one once it is done", async () => {
    const first = await createItRequest(error, { actor: auto });
    const again = await createItRequest(error, { actor: auto });
    expect(again).toMatchObject({ created: false });
    expect(again.request.id).toBe(first.request.id);
    expect(await appDb.itRequest.count()).toBe(1);

    await appDb.itRequest.update({ where: { id: first.request.id }, data: { status: "MERGED" } });
    const regression = await createItRequest(error, { actor: auto });
    expect(regression.created).toBe(true);
    expect(regression.request.number).toBe("IT-1002");
  });
});

describe("handing a request to the assistant", () => {
  it("creates the session as the person for a change request, with the right intent and context", async () => {
    const client = fakeClient();
    const { request } = await createItRequest({ ...feature, context: { route: "/dashboard", role: "ADMIN" } }, by);
    const r = await startItRequest(request.id, client);

    expect(r.started).toBe(true);
    expect(r.request).toMatchObject({ sessionId: "sess-1", status: "DRAFTING_SPEC", lastError: null });
    expect(client.createSession).toHaveBeenCalledTimes(1);
    const [input, who] = client.createSession.mock.calls[0] as unknown as [any, any];
    expect(input.intent).toBe("feature");
    expect(input.text).toBe("Rename the dashboard panel\n\nCall it Recent activities");
    expect(input.context).toMatchObject({ itRequest: { number: "IT-1001", kind: "FEATURE" }, route: "/dashboard", role: "ADMIN" });
    expect(who).toEqual({ email: "priya@example.com", name: "Priya Nair", role: "requester" });
  });

  it("starts errors as an automatic bug fix with no person behind it, and findings can ask for maintenance", async () => {
    const client = fakeClient();
    const e = await createItRequest(error, { actor: auto });
    await startItRequest(e.request.id, client);
    const f = await createItRequest({ kind: "FINDING", title: "lodash 4.17.20 vulnerable", description: "Bump to 4.17.21", intent: "maintenance", sourceType: "finding", sourceId: "f1" }, { actor: auto });
    await startItRequest(f.request.id, client);

    const calls = client.createSession.mock.calls as unknown as [any, any][];
    expect(calls[0]![0].intent).toBe("bugfix");
    expect(calls[0]![1]).toBeUndefined();
    expect(calls[1]![0].intent).toBe("maintenance");
  });

  it("is idempotent, and two processes starting at once create one session", async () => {
    const client = fakeClient({ createSession: vi.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return aiSession(); }) });
    const { request } = await createItRequest(feature, by);
    const [a, b] = await Promise.all([startItRequest(request.id, client), startItRequest(request.id, client)]);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect([a.started, b.started].sort()).toEqual([false, true]);

    await startItRequest(request.id, client);
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it("keeps a request Submitted with the reason when the assistant is unreachable, then retries on the next sync", async () => {
    const down = fakeClient({ createSession: vi.fn(async () => { throw new AiBuilderError(0, "Could not reach AI Builder: ECONNREFUSED"); }) });
    const { request, started, reason } = await submitItRequest(feature, by, down);
    expect(started).toBe(false);
    expect(reason).toContain("ECONNREFUSED");
    expect(request).toMatchObject({ status: "SUBMITTED", sessionId: null, lastError: expect.stringContaining("ECONNREFUSED"), startingAt: null });

    const up = fakeClient();
    const synced = await syncItRequest(request.id, up);
    expect(synced).toMatchObject({ sessionId: "sess-1", status: "DRAFTING_SPEC", lastError: null });
  });

  it("does nothing, and says why, when AI Builder is not configured", async () => {
    const { request } = await createItRequest(feature, by);
    const r = await startItRequest(request.id, null);
    expect(r).toMatchObject({ started: false, reason: "AI Builder is not configured" });
    expect((await getItRequest(request.id))!.sessionId).toBeNull();
  });
});

describe("following the assistant's progress", () => {
  async function started(client = fakeClient()) {
    const { request } = await createItRequest(feature, by);
    await startItRequest(request.id, client);
    return { id: request.id, client };
  }

  it("mirrors status, PR, preview and cost, and records a change once", async () => {
    const { id, client } = await started();
    client.getSession.mockResolvedValue(
      detail("sess-1", "pr_open", {
        prUrl: "https://github.com/x/y/pull/7",
        costUsd: 1.25,
        events: [{ type: "commit_pushed", sha: "abc" }, { type: "preview_ready", sha: "abc", url: "https://preview.test" }],
      }),
    );
    const after = await syncItRequest(id, client);
    expect(after).toMatchObject({ status: "PR_OPEN", sessionStatus: "pr_open", prUrl: "https://github.com/x/y/pull/7", previewUrl: "https://preview.test", costUsd: 1.25, lastError: null });
    expect(after!.lastSyncedAt).toBeTruthy();

    await syncItRequest(id, client);
    const changes = (await listEntityTimeline("itRequest", id)).filter((e) => e.kind === "STATUS_CHANGED");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ actorType: "SYSTEM", summary: "IT-1001: Ready to try" });
  });

  it("stops looking at a request once it is done", async () => {
    const { id, client } = await started();
    client.getSession.mockResolvedValue(detail("sess-1", "merged"));
    await syncItRequest(id, client);
    client.getSession.mockClear();

    await syncItRequest(id, client);
    expect(client.getSession).not.toHaveBeenCalled();
    expect((await getItRequest(id))!.status).toBe("MERGED");
  });

  it("marks a request failed when its session is gone, and keeps the status on other errors", async () => {
    const gone = await started();
    gone.client.getSession.mockRejectedValue(new AiBuilderError(404, "Session not found"));
    expect(await syncItRequest(gone.id, gone.client)).toMatchObject({ status: "FAILED" });

    const flaky = await started();
    flaky.client.getSession.mockRejectedValue(new AiBuilderError(502, "AI Builder answered 502"));
    const r = await syncItRequest(flaky.id, flaky.client);
    expect(r).toMatchObject({ status: "DRAFTING_SPEC", lastError: "AI Builder answered 502" });
  });

  it("syncs every open request, counts changes, and carries on past a failure", async () => {
    const client = fakeClient();
    const a = await createItRequest({ ...feature, title: "A" }, by);
    const b = await createItRequest({ ...feature, title: "B" }, by);
    const c = await createItRequest({ ...feature, title: "C" }, by);
    for (const r of [a, b, c]) await startItRequest(r.request.id, client); // sess-1, sess-2, sess-3
    client.getSession.mockImplementation(async (id: string) => {
      if (id === "sess-2") throw new AiBuilderError(500, "boom");
      return detail(id, id === "sess-1" ? "spec_review" : "building");
    });

    expect(await syncOpenItRequests(client)).toEqual({ checked: 3, changed: 2 });
    const byNumber = Object.fromEntries((await listItRequests()).map((r) => [r.number, r]));
    expect(byNumber["IT-1001"]!.status).toBe("SPEC_REVIEW");
    expect(byNumber["IT-1002"]).toMatchObject({ status: "DRAFTING_SPEC", lastError: "boom" });
    expect(byNumber["IT-1003"]!.status).toBe("BUILDING");
    expect(await syncOpenItRequests(null)).toEqual({ checked: 0, changed: 0 });
  });

  it("lists by status and kind, newest first", async () => {
    await createItRequest({ ...feature, title: "first" }, by);
    await createItRequest(error, { actor: auto });
    expect((await listItRequests()).map((r) => r.title)).toEqual(["TypeError on /quotes/[id]", "first"]);
    expect((await listItRequests({ kind: "ERROR" })).map((r) => r.number)).toEqual(["IT-1002"]);
    expect(await listItRequests({ status: ["MERGED"] })).toEqual([]);
  });
});

describe("requestCodeChange step", () => {
  const run = (params: Record<string, unknown>, context: Record<string, unknown> = {}) => runStep("requestCodeChange", { params }, context) as Promise<Record<string, any>>;

  it("changes nothing in a test run", async () => {
    const out = await run({ kind: "ERROR", title: "x", description: "y" }, { [TEST_MODE_CONTEXT_KEY]: true });
    expect(out).toMatchObject({ requested: false, simulated: true });
    expect(await appDb.itRequest.count()).toBe(0);
  });

  it("opens a request attributed to the automation, and reuses it for the same source", async () => {
    const first = await run({ kind: "error", title: "TypeError", description: "boom", sourceType: "error", sourceId: "fp-1", context: { route: "/x" } });
    expect(first).toMatchObject({ requested: true, number: "IT-1001", reused: false, started: false, reason: "AI Builder is not configured" });
    const again = await run({ kind: "ERROR", title: "TypeError", description: "boom", sourceType: "error", sourceId: "fp-1" });
    expect(again).toMatchObject({ requested: true, number: "IT-1001", reused: true });
    const row = (await getItRequest(first.itRequestId))!;
    expect(row).toMatchObject({ kind: "ERROR", requestedByLabel: "Automation", context: { route: "/x" } });
  });

  it("explains an invalid request instead of failing the run", async () => {
    const out = await run({ kind: "SOMETHING", title: "x", description: "y" });
    expect(out).toMatchObject({ requested: false, itRequestId: "" });
    expect(out.reason).toBeTruthy();
    expect(await appDb.itRequest.count()).toBe(0);
  });
});
