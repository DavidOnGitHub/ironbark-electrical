import type { WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";
import { enquiryToReply } from "./enquiryToReply";
import { invoiceChase } from "./invoiceChase";
import { quoteChase } from "./quoteChase";
import { reviewRequest } from "./reviewRequest";

export const ironSparkWorkflows: WorkflowDefinitionGraph[] = [enquiryToReply, quoteChase, invoiceChase, reviewRequest];

import { inboxAlias } from "../integrations/allowlist";

type Connectors = { emailConnectorId?: string; /** The connected Gmail account, e.g. "me@gmail.com". */ gmailAccount?: string };

/** Points every Gmail node (the inbox trigger, sendEmail, emailRead) at the connected Gmail account. */
export function wireConnectors(graph: WorkflowDefinitionGraph, { emailConnectorId, gmailAccount }: Connectors): WorkflowDefinitionGraph {
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

export { enquiryToReply, quoteChase, invoiceChase, reviewRequest };
