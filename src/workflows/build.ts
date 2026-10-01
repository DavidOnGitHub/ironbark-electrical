/** Small helpers so the four workflow definitions read like the process they describe. */
import { WorkflowDefinitionGraphSchema, type WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";

export const ref = (path: string) => ({ $ref: path });

export const GMAIL_RETRY = { maximumAttempts: 3, initialIntervalSeconds: 2, backoffCoefficient: 2 };
export const LLM_RETRY = { maximumAttempts: 3, initialIntervalSeconds: 5, backoffCoefficient: 2 };

export const HOURS = 3600;
export const DAYS = 24 * HOURS;

type Node = {
  id: string;
  type: "TRIGGER" | "ACTION" | "DECISION" | "HUMAN_TASK" | "DELAY";
  stepKey?: string;
  label: string;
  config?: Record<string, unknown>;
  retryPolicy?: { maximumAttempts: number; initialIntervalSeconds: number; backoffCoefficient: number };
  onFailureNodeId?: string;
  timeoutSeconds?: number;
};
type Edge = { from: string; to: string; when?: { field: string; op: "eq" | "neq" | "exists" | "notExists"; value?: unknown }; label?: string };

/** Lays the nodes out left to right in the order they are listed, and numbers the edges. */
export function defineWorkflow(def: { id: string; name: string }, nodes: Node[], edges: Edge[]): WorkflowDefinitionGraph {
  return WorkflowDefinitionGraphSchema.parse({
    id: def.id,
    name: def.name,
    version: 1,
    status: "DRAFT",
    nodes: nodes.map((n, i) => ({ stepKey: "", config: {}, ...n, position: { x: (i % 6) * 300, y: Math.floor(i / 6) * 200 } })),
    edges: edges.map((e, i) => ({ id: `e${i + 1}_${e.from}_${e.to}`, fromNodeId: e.from, toNodeId: e.to, ...(e.when ? { condition: e.when } : {}), ...(e.label ? { label: e.label } : {}) })),
  });
}
