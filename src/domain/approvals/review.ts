/**
 * What a person is being asked to approve. An approval task names the step it approves (`reviewsNodeId`); this
 * works out, from that step's settings and what the run has produced so far, exactly what that step will do -
 * for an email step, the email itself. Nothing is sent or changed here.
 */
import { emailVariables, resolveParams, str } from "../../steps/runtime";
import type { RenderedEmail } from "../emailTemplates/render";

export interface GraphNode {
  id: string;
  label?: string;
  stepKey?: string;
  config?: Record<string, unknown>;
}

export type Review =
  | { kind: "email"; stepLabel: string; to: string; subject: string; html: string; text: string; attachments?: string[] }
  | { kind: "plain-email"; stepLabel: string; to: string; subject: string; body: string }
  | { kind: "quote"; stepLabel: string; quoteId: string; number: string; title: string; clientName: string; status: string; lines: { description: string; quantity: string; totalText: string }[]; subtotalText: string; gstText: string; totalText: string; notes: string | null; problem: string | null }
  | { kind: "booking"; stepLabel: string; jobNumber: string; title: string; clientName: string; address: string | null; requestedText: string | null; technician: string | null; totalText: string | null; problem: string | null }
  | { kind: "fields"; stepLabel: string; rows: { label: string; value: string }[] }
  | { kind: "problem"; stepLabel: string; message: string };

type Render = (templateKey: string, vars: Record<string, string | undefined>) => Promise<RenderedEmail>;

const asText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export async function buildReview(nodes: GraphNode[], reviewsNodeId: string | undefined, context: Record<string, unknown>, render: Render): Promise<Review | null> {
  if (!reviewsNodeId) return null;
  const node = nodes.find((n) => n.id === reviewsNodeId);
  if (!node) return null;
  const stepLabel = node.label ?? node.id;
  const cfg = node.config ?? {};
  const params = resolveParams(cfg.params as Record<string, unknown> | undefined, context);

  if (node.stepKey === "sendTemplatedEmail") {
    const vars = emailVariables(params);
    try {
      const mail = await render(str(cfg.template), vars);
      return { kind: "email", stepLabel, to: str(params.to), subject: mail.subject, html: mail.html, text: mail.text, ...(str(params.attachInvoiceId) ? { attachments: ["The invoice as a PDF"] } : {}) };
    } catch (err) {
      return { kind: "problem", stepLabel, message: err instanceof Error ? err.message : "The email could not be prepared." };
    }
  }
  if (node.stepKey === "sendEmail") {
    return { kind: "plain-email", stepLabel, to: str(params.to), subject: str(params.subject), body: str(params.body) };
  }
  const rows = Object.entries(params).map(([label, value]) => ({ label, value: asText(value) }));
  return { kind: "fields", stepLabel, rows };
}
