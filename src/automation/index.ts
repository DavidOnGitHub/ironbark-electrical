/**
 * Starting the automations from the business's own actions: when a quote is sent,
 * an invoice is issued or an invoice is paid, the matching workflow is started - but
 * only if the owner has PUBLISHED it (a draft never runs for real) and automations
 * are not switched off. A failure here never undoes the business action; it is logged.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { startInstanceForDefinition } from "@kabosh-digital/workflow-temporal/instances";
import { WorkflowDefinitionGraphSchema } from "@kabosh-digital/workflow-types";

export const AUTOMATION_IDS = {
  enquiryToReply: "def_ironspark_enquiry_to_reply",
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

export const afterQuoteSent = (quoteId: string) => startAutomation("quoteChase", { quoteId });
export const afterInvoiceIssued = (invoiceId: string) => startAutomation("invoiceChase", { invoiceId });
export const afterInvoicePaid = (invoiceId: string) => startAutomation("reviewRequest", { invoiceId });
