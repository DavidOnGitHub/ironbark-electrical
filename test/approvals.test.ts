import { describe, expect, it } from "vitest";
import { buildReview, type GraphNode } from "../src/domain/approvals/review";

const nodes: GraphNode[] = [
  { id: "send_reply", label: "Send the approved reply", stepKey: "sendTemplatedEmail", config: { template: "enquiry_reply", params: { to: { $ref: "trigger.from" }, variables: { subject: { $ref: "trigger.subject" }, message: { $ref: "triage.replyDraft" } } } } },
  { id: "plain", label: "Plain send", stepKey: "sendEmail", config: { params: { to: "a@b.c", subject: { $ref: "trigger.subject" }, body: { $ref: "triage.replyDraft" } } } },
  { id: "other", label: "Log it", stepKey: "logAudit", config: { params: { event: "x", requestId: { $ref: "log.requestId" } } } },
];
const context = { trigger: { from: "Pat <pat@example.com>", subject: "Downlights" }, triage: { replyDraft: "Hi Pat,\n\nHappy to help." }, log: { requestId: "r1" } };
const render = async (key: string, vars: Record<string, string | undefined>) => {
  if (!vars.message) throw new Error("needs {{message}}");
  return { subject: `Re: ${vars.subject}`, text: `[${key}] ${vars.message}`, html: `<p>${vars.message}</p>`, missing: [] as string[] };
};

describe("what an approval shows", () => {
  it("nothing when the task does not name a step, or the step does not exist", async () => {
    expect(await buildReview(nodes, undefined, context, render)).toBeNull();
    expect(await buildReview(nodes, "ghost", context, render)).toBeNull();
  });
  it("the email a templated email step will send, resolved from the run so far", async () => {
    expect(await buildReview(nodes, "send_reply", context, render)).toEqual({
      kind: "email",
      stepLabel: "Send the approved reply",
      to: "Pat <pat@example.com>",
      subject: "Re: Downlights",
      text: "[enquiry_reply] Hi Pat,\n\nHappy to help.",
      html: "<p>Hi Pat,\n\nHappy to help.</p>",
    });
  });
  it("says what is wrong instead of showing a broken email", async () => {
    const r = await buildReview(nodes, "send_reply", { trigger: context.trigger }, render);
    expect(r).toMatchObject({ kind: "problem", message: "needs {{message}}" });
  });
  it("shows a plain email step as to, subject and body", async () => {
    expect(await buildReview(nodes, "plain", context, render)).toEqual({ kind: "plain-email", stepLabel: "Plain send", to: "a@b.c", subject: "Downlights", body: "Hi Pat,\n\nHappy to help." });
  });
  it("lists the resolved settings of any other step", async () => {
    expect(await buildReview(nodes, "other", context, render)).toEqual({ kind: "fields", stepLabel: "Log it", rows: [{ label: "event", value: "x" }, { label: "requestId", value: "r1" }] });
  });
});
