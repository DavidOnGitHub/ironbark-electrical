import { getLlmModelsForProvider, type WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";
import { enquiryToReply } from "./enquiryToReply";
import { invoiceChase } from "./invoiceChase";
import { quoteChase } from "./quoteChase";
import { reviewRequest } from "./reviewRequest";
import { visitToQuote } from "./visitToQuote";
import { jobBooking } from "./jobBooking";
import { jobToInvoice } from "./jobToInvoice";

export const ironSparkWorkflows: WorkflowDefinitionGraph[] = [enquiryToReply, visitToQuote, quoteChase, jobBooking, jobToInvoice, invoiceChase, reviewRequest];

import { inboxAlias } from "../integrations/allowlist";

type Connectors = {
  emailConnectorId?: string;
  /** The connected Gmail account, e.g. "me@gmail.com". */
  gmailAccount?: string;
  /** The connected AI provider (an LLM_PROVIDER connector) and its provider key, e.g. "openai". */
  llm?: { connectorId: string; provider?: string };
};

/** Points every Gmail node (the inbox trigger, sendEmail, emailRead) at the connected Gmail account. */
export function wireConnectors(graph: WorkflowDefinitionGraph, { emailConnectorId, gmailAccount, llm }: Connectors): WorkflowDefinitionGraph {
  return wireLlm(wireEmail(graph, { emailConnectorId, gmailAccount }), llm);
}

/** Points every aiAgent node at the connected AI provider, with that provider's default model so it never fails on a mismatched model id. */
function wireLlm(graph: WorkflowDefinitionGraph, llm: Connectors["llm"]): WorkflowDefinitionGraph {
  if (!llm) return graph;
  const model = (llm.provider && getLlmModelsForProvider(llm.provider)[0]?.id) || undefined;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.type === "ACTION" && n.stepKey === "aiAgent" ? { ...n, config: { ...n.config, connectorId: llm.connectorId, ...(model ? { model } : {}) } } : n)),
  };
}

function wireEmail(graph: WorkflowDefinitionGraph, { emailConnectorId, gmailAccount }: Pick<Connectors, "emailConnectorId" | "gmailAccount">): WorkflowDefinitionGraph {
  if (!emailConnectorId) return graph;
  // The inbox trigger only looks at mail sent to the demo's plus-alias (me+ironbark@gmail.com), never the rest of the mailbox.
  const query = gmailAccount ? `in:inbox -from:me to:${inboxAlias(gmailAccount, process.env.DEMO_INBOX_TAG || "ironbark")}` : undefined;
  const usesEmail = (n: { type: string; stepKey: string }) => (n.type === "TRIGGER" && n.stepKey === "emailInbound") || (n.type === "ACTION" && (n.stepKey === "sendEmail" || n.stepKey === "sendTemplatedEmail" || n.stepKey === "emailRead"));
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (!usesEmail(n)) return n;
      const isTrigger = n.type === "TRIGGER" && query;
      return { ...n, config: { ...n.config, connectorId: emailConnectorId, ...(isTrigger ? { query } : {}) } };
    }),
  };
}

export { enquiryToReply, quoteChase, invoiceChase, reviewRequest, visitToQuote, jobBooking, jobToInvoice };
