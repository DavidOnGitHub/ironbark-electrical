/* eslint-disable @typescript-eslint/no-explicit-any -- AI Builder replies are dynamic JSON in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { acceptItChange, answerItQuestions, approveItSpec, cancelItRequest, createItRequest, getItConversation, ItActionError, readConversation, requestItSpecChanges, type AiBuilderClient, type Responder } from "../src/domain/it";
import { listEntityTimeline } from "../src/domain/activity";
import { truncateAll } from "./helpers";

const person = (over: Partial<Responder> = {}): Responder => ({
  actor: { type: "USER", userId: "u1", label: "Priya" },
  userId: "u1",
  email: "priya@example.com",
  name: "Priya Nair",
  roles: ["ADMIN"],
  ...over,
});
const technician = person({ userId: "u2", actor: { type: "USER", userId: "u2", label: "Tom" }, email: "tom@example.com", name: "Tom", roles: ["OPERATOR"] });

const session = (status: string, over: Record<string, unknown> = {}) => ({ id: "s1", appId: "ironbark", intent: "feature", title: "T", status, costUsd: 0, prUrl: null, ...over });
const question = { type: "question", questions: [{ id: "q1", header: "Where", question: "Which page?", options: [{ label: "Quotes", description: "the list" }, { label: "Jobs" }], multiSelect: false }] };
const specEvent = { type: "spec_ready", version: 2, spec: { title: "Rename panel", summary: "Call it Recent activities", acceptanceCriteria: [{ id: "AC-1", text: "Shows the new name" }], edgeCases: ["Long names"], outOfScope: ["Other panels"] } };

function fake(events: any[], status: string, over: Record<string, unknown> = {}) {
  const client = {
    createSession: vi.fn(),
    getSession: vi.fn(async () => ({ session: session(status), events, acceptance: null })),
    sendMessage: vi.fn(),
    approveSpec: vi.fn(),
    requestChanges: vi.fn(),
    accept: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
  return client as typeof client & AiBuilderClient;
}

/** A request that already has a session, asked for by the technician. */
async function started(status = "SPEC_REVIEW") {
  const { request } = await createItRequest({ kind: "FEATURE", title: "Rename panel", description: "Call it Recent activities" }, { actor: technician.actor, email: technician.email });
  return appDb.itRequest.update({ where: { id: request.id }, data: { sessionId: "s1", status: status as any } });
}

beforeEach(truncateAll);
afterAll(() => appDb.$disconnect());

describe("reading a conversation", () => {
  const detail = (events: any[], status: string, acceptance: any = null) => ({ session: session(status), events, acceptance }) as any;

  it("shows the questions only while they are unanswered", () => {
    expect(readConversation(detail([question], "awaiting_user")).questions).toEqual([{ id: "q1", header: "Where", question: "Which page?", options: [{ label: "Quotes", description: "the list" }, { label: "Jobs", description: undefined }], multiSelect: false }]);
    expect(readConversation(detail([question, { type: "user_answers", answers: [] }], "awaiting_user")).questions).toEqual([]);
    expect(readConversation(detail([question], "working")).questions).toEqual([]);
  });

  it("reads the latest plan and whether it was decided", () => {
    const pending = readConversation(detail([specEvent], "spec_review")).spec;
    expect(pending).toMatchObject({ version: 2, title: "Rename panel", acceptanceCriteria: ["Shows the new name"], edgeCases: ["Long names"], outOfScope: ["Other panels"], state: "pending" });
    expect(readConversation(detail([specEvent, { type: "spec_approved", version: 2 }], "approved")).spec?.state).toBe("approved");
    expect(readConversation(detail([specEvent, { type: "changes_requested", version: 2, feedback: "x" }], "working")).spec?.state).toBe("changes_requested");
    const v3 = { ...specEvent, version: 3 };
    expect(readConversation(detail([specEvent, { type: "changes_requested", version: 2, feedback: "x" }, v3], "spec_review")).spec).toMatchObject({ version: 3, state: "pending" });
  });

  it("carries the acceptance state and survives odd events", () => {
    const c = readConversation(detail([{ type: "question" }, { type: "spec_ready", version: 1 }, { type: "error", message: "boom" }, { type: "assistant_message", text: "hi" }], "pr_open", { mode: "owner", sha: "abc1234", ready: false, blockers: ["Checks are running"], previewUrl: null }));
    expect(c).toMatchObject({ questions: [], spec: null, lastError: "boom", lastMessage: "hi", acceptance: { sha: "abc1234", ready: false, blockers: ["Checks are running"] } });
  });
});

describe("answering and deciding", () => {
  it("lets the person who asked answer, on their behalf, and records it", async () => {
    const row = await started("NEEDS_ANSWERS");
    const client = fake([question], "awaiting_user");
    await answerItQuestions(row.id, [{ questionId: "q1", selected: ["Quotes"], other: "  " }, { questionId: "q2", selected: [] }], technician, client);
    expect(client.sendMessage).toHaveBeenCalledWith("s1", { answers: [{ questionId: "q1", selected: ["Quotes"], other: undefined }] }, { email: "tom@example.com", name: "Tom", role: "requester" });
    const events = await listEntityTimeline("itRequest", row.id);
    expect(events.some((e) => e.summary.includes("questions answered"))).toBe(true);
  });

  it("refuses an empty answer and another technician's request", async () => {
    const row = await started("NEEDS_ANSWERS");
    const client = fake([], "awaiting_user");
    await expect(answerItQuestions(row.id, [{ questionId: "q1", selected: [] }], technician, client)).rejects.toBeInstanceOf(ItActionError);
    const other = person({ userId: "u9", roles: ["OPERATOR"], email: "o@example.com" });
    await expect(answerItQuestions(row.id, [{ questionId: "q1", selected: ["A"] }], other, client)).rejects.toThrow(/person who asked/);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("lets only Owner and Office approve and accept, and credits them as approver", async () => {
    const row = await started();
    const client = fake([specEvent], "spec_review");
    await expect(approveItSpec(row.id, 2, technician, client)).rejects.toThrow(/Owner or Office/);
    await expect(acceptItChange(row.id, "abc1234", technician, client)).rejects.toThrow(/Owner or Office/);
    await approveItSpec(row.id, 2, person({ roles: ["EDITOR"] }), client);
    expect(client.approveSpec).toHaveBeenCalledWith("s1", 2, { email: "priya@example.com", name: "Priya Nair", role: "approver" });
    await acceptItChange(row.id, "abc1234", person(), client);
    expect(client.accept).toHaveBeenCalledWith("s1", "abc1234", expect.objectContaining({ role: "approver" }));
  });

  it("lets the requester push back on the plan, but needs the feedback", async () => {
    const row = await started();
    const client = fake([specEvent], "spec_review");
    await expect(requestItSpecChanges(row.id, 2, "   ", technician, client)).rejects.toThrow(/what should change/);
    await requestItSpecChanges(row.id, 2, "Also the mobile view", technician, client);
    expect(client.requestChanges).toHaveBeenCalledWith("s1", 2, "Also the mobile view", expect.objectContaining({ role: "requester" }));
  });

  it("explains AI Builder's refusals and refuses finished or not-started requests", async () => {
    const row = await started();
    const client = fake([], "spec_review", { approveSpec: vi.fn(async () => { throw Object.assign(new Error("Spec version is stale"), { status: 409 }); }) });
    const { AiBuilderError } = await import("../src/domain/it");
    client.approveSpec.mockImplementation(async () => { throw new AiBuilderError(409, "Spec version is stale"); });
    await expect(approveItSpec(row.id, 1, person(), client)).rejects.toThrow(/could not do that now: Spec version is stale/);

    await appDb.itRequest.update({ where: { id: row.id }, data: { status: "MERGED" } });
    await expect(cancelItRequest(row.id, person(), client)).rejects.toThrow(/finished/);
    const fresh = await createItRequest({ kind: "FEATURE", title: "New", description: "d" }, { actor: technician.actor });
    await expect(cancelItRequest(fresh.request.id, person(), client)).rejects.toThrow(/not picked this up/);
  });

  it("needs an email to say who acted", async () => {
    const row = await started();
    await expect(approveItSpec(row.id, 2, person({ email: null }), fake([], "spec_review"))).rejects.toThrow(/no email/);
  });

  it("reports a failure to reach AI Builder instead of throwing when reading", async () => {
    const row = await started();
    const down = fake([], "x", { getSession: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) });
    expect(await getItConversation(row.id, down)).toMatchObject({ conversation: null, error: "ECONNREFUSED" });
  });
});
