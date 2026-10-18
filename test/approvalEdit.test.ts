import { describe, expect, it } from "vitest";
import { approvalOutput, editableFor } from "../src/domain/approvals/edit";
import { buildReview } from "../src/domain/approvals/review";
import { emailVariables } from "../src/steps/runtime";
import { enquiryToReply } from "../src/workflows/enquiryToReply";

const nodes = (enquiryToReply as unknown as { nodes: { id: string; label?: string; stepKey?: string; config?: Record<string, unknown> }[] }).nodes;
const approveInput = nodes.find((n) => n.id === "approve_reply")!.config;
const baseContext = { trigger: { from: "Pat <pat@example.com>", subject: "Rewire", message_id: "m1" }, triage: { replyDraft: "Hi Pat,\n\nDraft from the AI." }, log_enquiry: { requestId: "r1", bookingUrl: "https://example.com/book/abc" } };
const render = async (key: string, vars: Record<string, string | undefined>) => ({ subject: key, html: "", text: `[${key}] ${vars.message}`, missing: [] as string[] });

describe("email variables", () => {
  it("fills a variable that has no value from its default, and keeps one that has", () => {
    expect(emailVariables({ variables: { message: undefined, subject: "S" }, variableDefaults: { message: "draft" } })).toEqual({ message: "draft", subject: "S" });
    expect(emailVariables({ variables: { message: "edited" }, variableDefaults: { message: "draft" } })).toEqual({ message: "edited" });
    expect(emailVariables({ variables: { note: "" }, variableDefaults: { note: "draft" } })).toEqual({ note: "" }); // an empty value is a value
  });
});

describe("edit before approving", () => {
  it("offers the AI's draft for editing on the enquiry reply", () => {
    expect(editableFor(approveInput, nodes, baseContext)).toMatchObject({ variable: "message", text: "Hi Pat,\n\nDraft from the AI." });
  });
  it("offers the edited text once there is one, and nothing on an approval with nothing to edit", () => {
    expect(editableFor(approveInput, nodes, { ...baseContext, approve_reply: { message: "Hi Pat, edited" } })?.text).toBe("Hi Pat, edited");
    expect(editableFor({ approval: true, reviewsNodeId: "send_reply" }, nodes, baseContext)).toBeNull();
    expect(editableFor({ editsVariable: "message", reviewsNodeId: "nope" }, nodes, baseContext)).toBeNull();
  });
  it("hands the run the edited text on approve, and just no on reject", () => {
    expect(approvalOutput(approveInput, "approve", "  Hi Pat,\r\n\r\nSee you Tuesday.  ")).toEqual({ ok: true, output: { approved: true, message: "Hi Pat,\n\nSee you Tuesday." } });
    expect(approvalOutput(approveInput, "reject", "ignored")).toEqual({ ok: true, output: { approved: false } });
  });
  it("will not send an empty message, or an unknown decision", () => {
    expect(approvalOutput(approveInput, "approve", "   ")).toMatchObject({ ok: false });
    expect(approvalOutput(approveInput, "approve", "x".repeat(6001))).toMatchObject({ ok: false });
    expect(approvalOutput(approveInput, "maybe", "x")).toMatchObject({ ok: false });
  });
  it("leaves an approval with no editable text as a plain approve", () => {
    expect(approvalOutput({ approval: true }, "approve", undefined)).toEqual({ ok: true, output: { approved: true } });
  });
  it("shows the draft before anyone edits, and the edit afterwards, in the email preview", async () => {
    const before = await buildReview(nodes, "send_reply", baseContext, render);
    expect((before as { text: string }).text).toContain("Draft from the AI.");
    const after = await buildReview(nodes, "send_reply", { ...baseContext, approve_reply: { approved: true, message: "Hi Pat, edited" } }, render);
    expect((after as { text: string }).text).toContain("Hi Pat, edited");
  });
});
