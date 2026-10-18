/**
 * Starting the automations from the business's own actions: when a quote is sent,
 * an invoice is issued or an invoice is paid, the matching workflow is started - but
 * only if the owner has PUBLISHED it (a draft never runs for real) and automations
 * are not switched off. A failure here never undoes the business action; it is logged.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { startInstanceForDefinition } from "@kabosh-digital/workflow-temporal/instances";
import { cancelWorkflowInstance } from "@kabosh-digital/workflow-temporal/client";
import { WorkflowDefinitionGraphSchema } from "@kabosh-digital/workflow-types";

export const AUTOMATION_IDS = {
  enquiryToReply: "def_ironspark_enquiry_to_reply",
  visitToQuote: "def_ironspark_visit_to_quote",
  jobBooking: "def_ironspark_job_booking",
  jobToInvoice: "def_ironspark_job_to_invoice",
  quoteChase: "def_ironspark_quote_chase",
  invoiceChase: "def_ironspark_invoice_chase",
  reviewRequest: "def_ironspark_review_request",
} as const;
export type AutomationKey = keyof typeof AUTOMATION_IDS;

export type StartResult = { started: true; instanceId: string } | { started: false; reason: string };

export function automationsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AUTOMATIONS ?? "on").toLowerCase() !== "off";
}

export interface StoredDefinition {
  id: string;
  status: string;
  publishedGraph: unknown;
  publishedVersion: number | null;
}

/** What starting an automation touches - parameters so tests can supply their own. */
export interface AutomationDeps {
  loadDefinition: (id: string) => Promise<StoredDefinition | null>;
  start: typeof startInstanceForDefinition;
}

const realDeps: AutomationDeps = {
  loadDefinition: (id) => prisma.workflowDefinition.findUnique({ where: { id } }),
  start: startInstanceForDefinition,
};

export async function startAutomation(key: AutomationKey, trigger: Record<string, unknown>, deps: AutomationDeps = realDeps): Promise<StartResult> {
  if (!automationsEnabled()) return { started: false, reason: "automations are switched off" };
  try {
    const row = await deps.loadDefinition(AUTOMATION_IDS[key]);
    if (!row) return { started: false, reason: "workflow is not set up yet" };
    if (row.status !== "PUBLISHED" || !row.publishedGraph) return { started: false, reason: "workflow is not published" };
    const graph = WorkflowDefinitionGraphSchema.parse(row.publishedGraph);
    const { instanceId } = await deps.start({
      definitionId: row.id,
      graph,
      initialContext: trigger,
      mode: "PRODUCTION",
      graphVersion: row.publishedVersion ?? undefined,
      graphStatus: "PUBLISHED",
    });
    return { started: true, instanceId };
  } catch (err) {
    console.error(`[automation] could not start ${key}:`, err instanceof Error ? err.message : err);
    return { started: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

export const afterSiteVisitDone = (visitId: string) => startAutomation("visitToQuote", { visitId });
export const afterJobSlotChosen = (jobId: string) => startAutomation("jobBooking", { jobId });
export const afterJobCompleted = (jobId: string) => startAutomation("jobToInvoice", { jobId });
export const afterQuoteSent = (quoteId: string) => startAutomation("quoteChase", { quoteId });
export const afterInvoiceIssued = (invoiceId: string) => startAutomation("invoiceChase", { invoiceId });
export const afterInvoicePaid = (invoiceId: string) => startAutomation("reviewRequest", { invoiceId });

/** What stopping a run touches - parameters so tests can supply their own. */
export interface StopDeps {
  findRunning: (definitionId: string) => Promise<{ id: string; context: unknown }[]>;
  cancel: (instanceId: string) => Promise<void>;
  finish: (instanceId: string) => Promise<void>;
}

const realStopDeps: StopDeps = {
  findRunning: (definitionId) => prisma.workflowInstance.findMany({ where: { definitionId, status: "RUNNING", mode: "PRODUCTION" }, select: { id: true, context: true } }),
  cancel: cancelWorkflowInstance,
  finish: async (id) => {
    // Same as Cancel in the console: the run reads Cancelled, and an approval it was waiting on is no longer needed.
    await prisma.workflowInstance.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } });
    await prisma.workflowTask.deleteMany({ where: { instanceId: id, status: "PENDING" } });
  },
};

/** The customer has answered the quote, so its follow-up run has nothing left to do: stop it now rather than
 * leaving it asleep until its next check. Returns how many runs were stopped; never throws (the answer stands). */
export async function stopQuoteChase(quoteId: string, deps: StopDeps = realStopDeps): Promise<number> {
  let stopped = 0;
  try {
    for (const run of await deps.findRunning(AUTOMATION_IDS.quoteChase)) {
      if ((run.context as { trigger?: { quoteId?: string } } | null)?.trigger?.quoteId !== quoteId) continue;
      await deps.cancel(run.id).catch((err) => console.warn(`[automation] Temporal cancel failed for ${run.id}:`, err instanceof Error ? err.message : err));
      await deps.finish(run.id);
      stopped++;
    }
  } catch (err) {
    console.error("[automation] could not stop the quote follow-up:", err instanceof Error ? err.message : err);
  }
  return stopped;
}
