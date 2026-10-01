import type { WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";
import { enquiryToReply } from "./enquiryToReply";
import { invoiceChase } from "./invoiceChase";
import { quoteChase } from "./quoteChase";
import { reviewRequest } from "./reviewRequest";

export const ironSparkWorkflows: WorkflowDefinitionGraph[] = [enquiryToReply, quoteChase, invoiceChase, reviewRequest];

type Connectors = { emailConnectorId?: string };

/** Points every Gmail node (the inbox trigger, sendEmail, emailRead) at the connected Gmail account. */
export function wireConnectors(graph: WorkflowDefinitionGraph, { emailConnectorId }: Connectors): WorkflowDefinitionGraph {
  if (!emailConnectorId) return graph;
  const usesEmail = (n: { type: string; stepKey: string }) => (n.type === "TRIGGER" && n.stepKey === "emailInbound") || (n.type === "ACTION" && (n.stepKey === "sendEmail" || n.stepKey === "emailRead"));
  return { ...graph, nodes: graph.nodes.map((n) => (usesEmail(n) ? { ...n, config: { ...n.config, connectorId: emailConnectorId } } : n)) };
}

export { enquiryToReply, quoteChase, invoiceChase, reviewRequest };
