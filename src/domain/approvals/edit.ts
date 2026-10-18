/**
 * Edit before approving. An approval task can name one email variable a person may rewrite
 * (`editsVariable`, for example the AI's drafted message). Approving then hands the run
 * `{ approved: true, <variable>: <text> }`, and the email step reads it from there; rejecting
 * hands back `{ approved: false }`. Pure rules - nothing here touches the database.
 */
import { emailVariables, resolveParams } from "../../steps/runtime";
import type { GraphNode } from "./review";
import type { WorkflowContext } from "@kabosh-digital/workflow-types";

export interface Editable {
  variable: string;
  /** What the email says now (the AI's draft, or whatever the step would send). */
  text: string;
  hint: string | null;
}

/** The variable a person may edit on this approval, with its current text; null when the approval is not editable. */
export function editableFor(taskInput: unknown, nodes: GraphNode[], context: WorkflowContext): Editable | null {
  const input = (taskInput ?? {}) as { editsVariable?: unknown; editHint?: unknown; reviewsNodeId?: unknown };
  if (typeof input.editsVariable !== "string" || !input.editsVariable || typeof input.reviewsNodeId !== "string") return null;
  const node = nodes.find((n) => n.id === input.reviewsNodeId);
  if (!node || node.stepKey !== "sendTemplatedEmail") return null;
  const params = resolveParams((node.config?.params ?? {}) as Record<string, unknown>, context);
  const text = emailVariables(params)[input.editsVariable];
  if (text === undefined) return null;
  return { variable: input.editsVariable, text, hint: typeof input.editHint === "string" ? input.editHint : null };
}

export type ApprovalOutcome = { ok: true; output: Record<string, unknown> } | { ok: false; error: string };

/** What the run receives for a person's decision. Only an editable approval accepts (and requires) edited text. */
export function approvalOutput(taskInput: unknown, decision: string | undefined, edited: string | undefined): ApprovalOutcome {
  if (decision === "reject") return { ok: true, output: { approved: false } };
  if (decision !== "approve") return { ok: false, error: "This is an approval task - use Approve or Reject." };
  const variable = (taskInput as { editsVariable?: unknown } | null)?.editsVariable;
  if (typeof variable !== "string" || !variable) return { ok: true, output: { approved: true } };
  const text = (edited ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "The message cannot be empty. Reject it instead to reply by hand." };
  if (text.length > 6000) return { ok: false, error: "The message is too long." };
  return { ok: true, output: { approved: true, [variable]: text } };
}
