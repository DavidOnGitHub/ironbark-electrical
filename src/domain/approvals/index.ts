import { prisma } from "@kabosh-digital/workflow-schema";
import { renderTemplate } from "../emailTemplates";
import { getQuote } from "../quotes";
import { getInvoice } from "../invoicing";
import { activeHold, getJob } from "../jobs";
import { formatSite } from "../clients";
import { staffLabelMap } from "../shared/staff";
import { formatDayTime, formatTime } from "../../lib/tz";
import { formatMoney } from "../../lib/money";
import { resolveParams, str } from "../../steps/runtime";
import { buildReview, type GraphNode, type Review } from "./review";
import { editableFor, type Editable } from "./edit";

export { buildReview, type Review } from "./review";
export { approvalOutput, editableFor, type Editable } from "./edit";

type Json = Record<string, unknown> | null;

/** The review for a pending approval task, from its definition's graph and its run's progress so far. */
export async function reviewForTask(task: { input: unknown; instance: { context: unknown; definition: { graph: unknown; publishedGraph: unknown } } }): Promise<Review | null> {
  const reviewsNodeId = (task.input as { reviewsNodeId?: unknown } | null)?.reviewsNodeId;
  if (typeof reviewsNodeId !== "string") return null;
  const def = task.instance.definition;
  const graph = ((def.publishedGraph ?? def.graph) as { nodes?: GraphNode[] } | null) ?? {};
  const context = ((task.instance.context ?? {}) as Json) ?? {};
  const node = (graph.nodes ?? []).find((n) => n.id === reviewsNodeId);
  if (node?.stepKey === "sendQuote") return quoteReview(node, context);
  if (node?.stepKey === "confirmJobBooking") return bookingReview(node, context);
  if (node?.stepKey === "sendInvoice") return invoiceReview(node, context);
  return buildReview(graph.nodes ?? [], reviewsNodeId, context, renderTemplate);
}

/** For an approval that issues an invoice: the invoice itself, so the office can read it (and open it to edit) before approving. */
async function invoiceReview(node: GraphNode, context: Record<string, unknown>): Promise<Review> {
  const stepLabel = node.label ?? node.id;
  const invoiceId = str(resolveParams((node.config?.params ?? {}) as Record<string, unknown>, context as never).invoiceId);
  const invoice = invoiceId ? await getInvoice(invoiceId) : null;
  if (!invoice) return { kind: "problem", stepLabel, message: "The invoice could not be found. It may have been deleted." };
  const problem = invoice.status !== "DRAFT" ? "This invoice has already been issued or voided." : invoice.lines.length === 0 || invoice.totalCents <= 0 ? "This invoice has no priced lines. Open it and add them before approving." : null;
  return {
    kind: "invoice",
    stepLabel,
    invoiceId: invoice.id,
    number: invoice.number,
    title: invoice.job.title,
    clientName: invoice.client.name,
    status: invoice.status,
    lines: invoice.lines.map((l) => ({ description: l.description, quantity: `${Number(l.quantity)} ${l.unit}`, totalText: formatMoney(l.lineTotalCents) })),
    subtotalText: formatMoney(invoice.subtotalCents),
    gstText: formatMoney(invoice.gstCents),
    totalText: formatMoney(invoice.totalCents),
    creditText: invoice.creditCents > 0 ? formatMoney(invoice.creditCents) : null,
    balanceText: formatMoney(invoice.balanceCents),
    notes: invoice.notes,
    problem,
  };
}

/** For an approval that confirms a customer's picked day: the job, where, when and who - and a warning if the time is no longer held. */
async function bookingReview(node: GraphNode, context: Record<string, unknown>): Promise<Review> {
  const stepLabel = node.label ?? node.id;
  const jobId = str(resolveParams((node.config?.params ?? {}) as Record<string, unknown>, context as never).jobId);
  const job = jobId ? await getJob(jobId) : null;
  if (!job) return { kind: "problem", stepLabel, message: "The job could not be found." };
  const hold = activeHold(job);
  const labels = await staffLabelMap();
  return {
    kind: "booking",
    stepLabel,
    jobNumber: job.number,
    title: job.title,
    clientName: job.client.name,
    address: job.site ? formatSite(job.site) : null,
    requestedText: hold ? `${formatDayTime(hold.start)} - ${formatTime(hold.end)}` : null,
    technician: hold ? (labels.get(hold.userId) ?? null) : null,
    totalText: job.quote ? formatMoney(job.quote.totalCents) : null,
    problem: job.status !== "UNSCHEDULED" ? "This job already has a time." : hold ? null : "The customer's time is no longer held (it lapsed or was changed). Reject to ask them to choose again.",
  };
}

/** For an approval that sends a quote: the quote itself, so the office can read it (and open it to edit) before approving. */
async function quoteReview(node: GraphNode, context: Record<string, unknown>): Promise<Review> {
  const stepLabel = node.label ?? node.id;
  const quoteId = str(resolveParams((node.config?.params ?? {}) as Record<string, unknown>, context as never).quoteId);
  const quote = quoteId ? await getQuote(quoteId) : null;
  if (!quote) return { kind: "problem", stepLabel, message: "The quote could not be found. It may have been deleted." };
  const problem = quote.status !== "DRAFT" ? "This quote has already been sent or answered." : quote.lines.length === 0 || quote.totalCents <= 0 ? "This quote has no priced lines yet. Open it and add them before approving." : null;
  return {
    kind: "quote",
    stepLabel,
    quoteId: quote.id,
    number: quote.number,
    title: quote.title,
    clientName: quote.client.name,
    status: quote.status,
    lines: quote.lines.map((l) => ({ description: l.description, quantity: `${Number(l.quantity)} ${l.unit}`, totalText: formatMoney(l.lineTotalCents) })),
    subtotalText: formatMoney(quote.subtotalCents),
    gstText: formatMoney(quote.gstCents),
    totalText: formatMoney(quote.totalCents),
    notes: quote.notes,
    problem,
  };
}

/** Pending approvals for one run (the run page shows what is being waited on). */
export async function reviewsForInstance(instanceId: string, viewer: { id: string; roles: string[] }) {
  const tasks = await prisma.workflowTask.findMany({
    // Same visibility as the console: an administrator sees every run, anyone else only runs of their own workflows.
    where: { instanceId, status: "PENDING", ...(viewer.roles.includes("ADMIN") ? {} : { instance: { definition: { ownerId: viewer.id } } }) },
    include: { instance: { include: { definition: { select: { graph: true, publishedGraph: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const out: { taskId: string; nodeId: string; review: Review }[] = [];
  for (const t of tasks) {
    const review = await reviewForTask(t);
    if (review) out.push({ taskId: t.id, nodeId: t.nodeId, review });
  }
  return out;
}

/** The text a person may rewrite on a pending approval, with the draft as it stands; null when the approval has nothing to edit. */
export function editableForTask(task: { input: unknown; instance: { context: unknown; definition: { graph: unknown; publishedGraph: unknown } } }): Editable | null {
  const def = task.instance.definition;
  const graph = ((def.publishedGraph ?? def.graph) as { nodes?: GraphNode[] } | null) ?? {};
  return editableFor(task.input, graph.nodes ?? [], (((task.instance.context ?? {}) as Json) ?? {}) as never);
}
