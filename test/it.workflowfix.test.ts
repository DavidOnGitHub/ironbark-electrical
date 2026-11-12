/* eslint-disable @typescript-eslint/no-explicit-any -- fake fetch and clients in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import {
  buildFeed,
  buildFixSummary,
  cancelItRequest,
  cancelWorkflowFix,
  captureError,
  classifyByRules,
  classifyError,
  locateFailure,
  openErrorFix,
  openWorkflowFix,
  plainProblem,
  resetErrorThrottle,
  syncItRequest,
  syncOpenItRequests,
  syncWorkflowFix,
  waitingOnPerson,
  workflowFixClientFromEnv,
  worthWorkflowFix,
  type FixAnswer,
  type ProposalState,
  type RunLookup,
  type WorkflowFixClient,
} from "../src/domain/it";
import { truncateAll } from "./helpers";

const ON = { IT_AUTOFIX: "on" };
const found: RunLookup = async () => ({ definitionId: "def_orders", nodeId: "send_mail" });

function fixClient(over: { answer?: FixAnswer; states?: { id: string; state: ProposalState }[]; statesError?: Error } = {}) {
  const propose = vi.fn<WorkflowFixClient["propose"]>(async () => over.answer ?? { ok: true, id: "prop_1", summary: "Fill in the recipient from the order.", reused: false });
  const states = vi.fn<WorkflowFixClient["states"]>(async () => {
    if (over.statesError) throw over.statesError;
    return over.states ?? [{ id: "prop_1", state: "PENDING" as ProposalState }];
  });
  const dismiss = vi.fn<WorkflowFixClient["dismiss"]>(async () => {});
  return { client: { propose, states, dismiss } as WorkflowFixClient, propose, states, dismiss };
}

const stepError = () => Object.assign(new Error("sendEmail needs a recipient: to is required"), { name: "Error" });
const capture = async (over: Record<string, unknown> = {}) =>
  (await captureError(stepError(), { source: "step", route: "step:sendEmail", context: { stepKey: "sendEmail", instanceId: "instance-run_1" }, ...over })) as { id: string };

describe("classifying a workflow setup problem", () => {
  it("rules: a step that stopped for a missing setting is a workflow problem", () => {
    const c = classifyByRules({ name: "Error", message: "sendEmail needs a recipient: to is required", source: "step", route: "step:sendEmail" });
    expect(c).toMatchObject({ class: "workflow_config", confidence: "medium", source: "rules" });
    expect(worthWorkflowFix(c)).toBe(true);
  });

  it("rules: the same words from a web request are not a workflow problem", () => {
    expect(classifyByRules({ name: "Error", message: "to is required", source: "request", route: "/quotes" }).class).not.toBe("workflow_config");
  });

  it("rules: a step that failed because a service was down is an outage, not a setup problem", () => {
    expect(classifyByRules({ name: "Error", message: "fetch failed: to is required", source: "step" }).class).toBe("external_outage");
    expect(classifyByRules({ name: "Error", message: "connect ECONNREFUSED 10.0.0.5:7233", source: "workflow" }).class).toBe("external_outage");
  });

  it("the model may pick it for a step, but not for a web request", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ class: "workflow_config", confidence: "high", reason: "A setting is empty." }) }] }) })) as unknown as typeof fetch;
    expect(await classifyError({ name: "Error", message: "m", source: "step" }, { apiKey: "k", fetchImpl })).toMatchObject({ class: "workflow_config", confidence: "high", source: "ai" });
    const web = await classifyError({ name: "Error", message: "m", source: "request", route: "/quotes" }, { apiKey: "k", fetchImpl });
    expect(web).toMatchObject({ class: "code_bug", confidence: "low" });
    expect(worthWorkflowFix(web)).toBe(false);
  });

  it("only medium or high confidence is worth preparing a fix", () => {
    expect(worthWorkflowFix({ class: "workflow_config", confidence: "low" })).toBe(false);
    expect(worthWorkflowFix({ class: "code_bug", confidence: "high" })).toBe(false);
  });
});

describe("the console client", () => {
  const env = { WORKFLOW_FIX_URL: "https://app.example/", WORKFLOW_FIX_SECRET: "s".repeat(24) };

  it("is off until both settings are present", () => {
    expect(workflowFixClientFromEnv({})).toBeNull();
    expect(workflowFixClientFromEnv({ WORKFLOW_FIX_URL: "https://x" })).toBeNull();
    expect(workflowFixClientFromEnv({ WORKFLOW_FIX_SECRET: "x".repeat(20) })).toBeNull();
  });

  it("asks with the secret, follows proposals and dismisses one", async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ ok: true, id: "p9", summary: "s", reused: false }) };
      if (init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, json: async () => ({ proposals: [{ id: "p9", status: "APPLIED" }] }) };
    }) as unknown as typeof fetch;
    const c = workflowFixClientFromEnv(env, fetchImpl)!;
    expect(await c.propose({ definitionId: "d", problem: "p", sourceKey: "k" })).toMatchObject({ ok: true, id: "p9" });
    expect(await c.states(["p9"])).toEqual([{ id: "p9", state: "APPLIED" }]);
    await c.dismiss("p9");
    expect(calls[0].url).toBe("https://app.example/api/assistant/propose-fix");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${env.WORKFLOW_FIX_SECRET}`);
    expect(calls[1].url).toContain("?ids=p9");
    expect(JSON.parse(calls[2].init.body)).toEqual({ id: "p9", action: "dismissed" });
    expect(await c.states([])).toEqual([]);
  });

  it("turns a refusal into a reason instead of throwing", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await workflowFixClientFromEnv(env, fetchImpl)!.propose({ definitionId: "d", problem: "p", sourceKey: "k" })).toEqual({ ok: false, reason: "The console answered 401" });
  });
});

describe("locating the failed workflow", () => {
  it("uses the run id kept with the error, with or without Temporal's prefix", async () => {
    const find = vi.fn(found);
    expect(await locateFailure({ instanceId: "instance-run_1" }, find)).toEqual({ definitionId: "def_orders", nodeId: "send_mail" });
    expect(find).toHaveBeenCalledWith("run_1", "instance-run_1");
    await locateFailure({ instanceId: "run_2" }, find);
    expect(find).toHaveBeenLastCalledWith("run_2", "run_2");
  });

  it("says nothing when no run was recorded", async () => {
    expect(await locateFailure({}, found)).toBeNull();
    expect(await locateFailure(null, found)).toBeNull();
    expect(await locateFailure({ instanceId: 5 }, found)).toBeNull();
  });
});

describe("preparing a workflow fix", () => {
  beforeEach(async () => {
    resetErrorThrottle();
    await truncateAll();
  });
  afterAll(async () => {
    await truncateAll();
    await appDb.$disconnect();
  });

  const kind = { class: "workflow_config" as const, confidence: "medium" as const, reason: "A setting is empty.", source: "rules" as const };

  it("keeps the run id with the captured error, exactly, and drops anything that is not an id", async () => {
    const { id } = await capture();
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id } })).context).toMatchObject({ stepKey: "sendEmail", instanceId: "instance-run_1" });
    resetErrorThrottle();
    const other = await capture({ route: "step:other", context: { instanceId: "has spaces; and 'quotes'" } });
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id: other.id } })).context).not.toHaveProperty("instanceId");
  });

  it("opens a request that waits for a person, with no AI Builder session", async () => {
    const { id } = await capture();
    const { client, propose } = fixClient();
    const out = await openWorkflowFix({ errorId: id, maxAttempts: 3, kind, lookup: found }, client);
    expect(out.opened).toBe(true);
    const row = await appDb.itRequest.findUniqueOrThrow({ where: { id: out.requestId! } });
    expect(row).toMatchObject({ kind: "ERROR", status: "PROPOSED", workflowProposalId: "prop_1", workflowId: "def_orders", sessionId: null, sourceType: "error", sourceId: id, title: "A background task showed an error" });
    const ask = propose.mock.calls[0]![0];
    expect(ask).toMatchObject({ definitionId: "def_orders", nodeId: "send_mail", sourceKey: `it-error:${id}:1` });
    expect(ask.problem).toMatch(/^A background task failed because of how this workflow is set up\./);
    expect(ask.evidence).toContain("to is required");
  });

  it("never lets the sync start an AI Builder session for it", async () => {
    const { id } = await capture();
    const { client } = fixClient();
    const { requestId } = await openWorkflowFix({ errorId: id, maxAttempts: 3, kind, lookup: found }, client);
    const ai = { createSession: vi.fn(), getSession: vi.fn() } as any;
    const after = await syncItRequest(requestId!, ai, client);
    expect(after!.status).toBe("PROPOSED");
    expect(ai.createSession).not.toHaveBeenCalled();
    expect((await syncOpenItRequests(ai, 100, client)).checked).toBe(1);
    expect(ai.createSession).not.toHaveBeenCalled();
  });

  it("does not ask again while a prepared fix waits, and stops after the attempt limit", async () => {
    const { id } = await capture();
    const { client, propose } = fixClient();
    const first = await openWorkflowFix({ errorId: id, maxAttempts: 2, kind, lookup: found }, client);
    const again = await openWorkflowFix({ errorId: id, maxAttempts: 2, kind, lookup: found }, client);
    expect(again).toMatchObject({ opened: false, requestId: first.requestId });
    expect(propose).toHaveBeenCalledTimes(1);

    await appDb.itRequest.update({ where: { id: first.requestId! }, data: { status: "CLOSED" } });
    expect((await openWorkflowFix({ errorId: id, maxAttempts: 2, kind, lookup: found }, client)).opened).toBe(true);
    expect(propose.mock.calls[1]![0].sourceKey).toBe(`it-error:${id}:2`);
    await appDb.itRequest.updateMany({ data: { status: "CLOSED" } });
    expect(await openWorkflowFix({ errorId: id, maxAttempts: 2, kind, lookup: found }, client)).toMatchObject({ opened: false, reason: expect.stringMatching(/Already tried 2 times/) });
  });

  it("records why nothing was prepared and opens no request", async () => {
    const { id } = await capture();
    const { client } = fixClient({ answer: { ok: false, reason: "A change to the workflow would not fix this." } });
    expect(await openWorkflowFix({ errorId: id, maxAttempts: 3, kind, lookup: found }, client)).toEqual({ opened: false, reason: "A change to the workflow would not fix this." });
    expect(await appDb.itRequest.count()).toBe(0);
    const note = await appDb.activityEvent.findFirst({ where: { entityType: "errorEvent", entityId: id }, orderBy: { at: "desc" } });
    expect(note!.summary).toBe("No workflow fix prepared: A change to the workflow would not fix this.");
  });

  it("says so when it is not set up or cannot tell which workflow failed", async () => {
    const { id } = await capture();
    expect((await openWorkflowFix({ errorId: id, maxAttempts: 3, kind, lookup: found }, null)).reason).toMatch(/not set up/);
    const { client, propose } = fixClient();
    expect(await openWorkflowFix({ errorId: id, maxAttempts: 3, kind, lookup: async () => null }, client)).toEqual({ opened: false, reason: "Could not tell which workflow failed" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("is what openErrorFix does for a workflow problem, and AI Builder is not asked", async () => {
    const { id } = await capture();
    const { client } = fixClient();
    const ai = { createSession: vi.fn() } as any;
    const out = await openErrorFix(id, ai, ON, null, client, found);
    expect(out.opened).toBe(true);
    expect(ai.createSession).not.toHaveBeenCalled();
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id } })).classification).toBe("workflow_config");
  });

  it("does nothing with auto-fix off", async () => {
    const { id } = await capture();
    const { client, propose } = fixClient();
    expect((await openErrorFix(id, null, {}, null, client, found)).opened).toBe(false);
    expect(propose).not.toHaveBeenCalled();
  });

  it("writes the problem in plain words and ignores a technical classifier reason", () => {
    expect(plainProblem("step", { reason: "A setting is empty." })).toBe("A background task failed because of how this workflow is set up. A setting is empty.");
    expect(plainProblem("workflow", { reason: "TypeError in src/steps/mail.ts" })).toBe("A background task failed because of how this workflow is set up.");
  });
});

describe("following a prepared fix", () => {
  beforeEach(async () => {
    resetErrorThrottle();
    await truncateAll();
  });

  const open = async () => {
    const { id } = await capture();
    const { client } = fixClient();
    const { requestId } = await openWorkflowFix({ errorId: id, maxAttempts: 3, kind: { class: "workflow_config", confidence: "medium", reason: "r", source: "rules" }, lookup: found }, client);
    return { errorId: id, requestId: requestId! };
  };

  it("stays waiting while nobody has answered", async () => {
    const { requestId } = await open();
    expect((await syncWorkflowFix(requestId, fixClient().client)).status).toBe("PROPOSED");
  });

  it("is applied when the person applied it in the editor, and the error counts as handled", async () => {
    const { requestId, errorId } = await open();
    const row = await syncWorkflowFix(requestId, fixClient({ states: [{ id: "prop_1", state: "APPLIED" }] }).client);
    expect(row.status).toBe("APPLIED");
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id: errorId } })).resolvedAt).not.toBeNull();
    const note = await appDb.activityEvent.findFirst({ where: { entityType: "errorEvent", entityId: errorId, summary: { startsWith: "Fix applied to the workflow" } } });
    expect(note).not.toBeNull();
  });

  it("closes when dismissed, and leaves the error open", async () => {
    const { requestId, errorId } = await open();
    expect((await syncWorkflowFix(requestId, fixClient({ states: [{ id: "prop_1", state: "DISMISSED" }] }).client)).status).toBe("CLOSED");
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id: errorId } })).resolvedAt).toBeNull();
  });

  it("closes when the proposal is gone because its workflow was deleted", async () => {
    const { requestId } = await open();
    const row = await syncWorkflowFix(requestId, fixClient({ states: [] }).client);
    expect(row).toMatchObject({ status: "CLOSED", lastError: "The workflow no longer exists" });
  });

  it("keeps waiting, and notes why, when the console cannot be reached", async () => {
    const { requestId } = await open();
    const row = await syncWorkflowFix(requestId, fixClient({ statesError: new Error("The console answered 502") }).client);
    expect(row).toMatchObject({ status: "PROPOSED", lastError: "The console answered 502" });
  });

  it("does nothing without a client", async () => {
    const { requestId } = await open();
    expect((await syncWorkflowFix(requestId, null)).status).toBe("PROPOSED");
  });

  it("a person can call it off: the console drops it and the request closes", async () => {
    const { requestId } = await open();
    const { client, dismiss } = fixClient();
    const row = await cancelWorkflowFix(requestId, { type: "SYSTEM", label: "x" }, client);
    expect(row.status).toBe("CLOSED");
    expect(dismiss).toHaveBeenCalledWith("prop_1");
  });

  it("cancelling goes through the same permission rule as any request", async () => {
    const { requestId } = await open();
    const stranger = { actor: { type: "USER" as const, userId: "u9", label: "Sam" }, userId: "u9", email: "s@x.test", name: "Sam", roles: ["CUSTOMER"] };
    await expect(cancelItRequest(requestId, stranger as any, null, fixClient().client)).rejects.toThrow(/Only the person who asked/);
    const owner = { ...stranger, roles: ["ADMIN"] };
    expect((await cancelItRequest(requestId, owner as any, null, fixClient().client)).status).toBe("CLOSED");
    await expect(cancelItRequest(requestId, owner as any, null, fixClient().client)).rejects.toThrow(/finished/);
  });
});

describe("how it reads to people", () => {
  it("has plain words for the new states", () => {
    expect(waitingOnPerson("PROPOSED")).toBe("Review the prepared fix in the workflow editor");
    expect(waitingOnPerson("APPLIED")).toBeNull();
  });

  const base = { number: "IT-1", status: "PROPOSED" as any, createdAt: new Date(1000), updatedAt: new Date(2000), mergedAt: null, deployError: null, prUrl: null, previewUrl: null, workflowProposalId: "p" };
  const error = { firstSeenAt: new Date(0), message: "m", route: "step:sendEmail", count: 2, resolvedAt: null as Date | null, regressions: 0, source: "step" };

  it("the feed says a fix to the workflow was prepared and what it waits for", () => {
    const feed = buildFeed({ error, reopenedAt: [], attempts: [{ request: base, events: null }] });
    expect(feed.map((f) => f.text)).toEqual(["A background task showed an error", "Assistant prepared a fix to the workflow", "Waiting for someone to review the prepared fix in the workflow editor"]);
  });

  it("the feed does not claim it is live once applied", () => {
    const feed = buildFeed({ error: { ...error, resolvedAt: new Date(5000) }, reopenedAt: [], attempts: [{ request: { ...base, status: "APPLIED" }, events: null }] });
    expect(feed.at(-1)!.text).toBe("Fix applied - publish the workflow to make it live, then watching for a repeat");
    expect(JSON.stringify(feed)).not.toMatch(/Fix is live/);
  });

  it("the summary says what happens now in plain words", () => {
    const req = (status: string) => ({ status: status as any, liveAt: null, previewUrl: null, title: "t" });
    expect(buildFixSummary({ error, request: req("PROPOSED"), events: null, since: null }).after).toBe("A change to the workflow is ready for someone to review.");
    expect(buildFixSummary({ error, request: req("APPLIED"), events: null, since: null }).after).toBe("The change was applied to the workflow. Publish the workflow to make it live.");
  });
});
