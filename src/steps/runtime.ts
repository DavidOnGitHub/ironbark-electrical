import { getByPath, type WorkflowContext } from "@kabosh-digital/workflow-types";
import { TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";

/** Resolves {"$ref": "node.field"} placeholders anywhere in a params tree against the run's context. */
function resolveValue(value: unknown, context: WorkflowContext): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, context));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") return getByPath(context, record.$ref);
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, resolveValue(v, context)]));
  }
  return value;
}

export function resolveParams(params: Record<string, unknown> | undefined, context: WorkflowContext): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, resolveValue(v, context)]));
}

/** A run started from the editor's "Test run": steps must not change real data or contact real people. */
export function isTestRun(context: WorkflowContext): boolean {
  return context[TEST_MODE_CONTEXT_KEY] === true;
}

export const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
