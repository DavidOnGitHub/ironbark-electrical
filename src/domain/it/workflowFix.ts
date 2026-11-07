/**
 * Fixes for failed workflow runs that need a change to the workflow, not to the app's code.
 *
 * When an error from a step or a workflow run is classified as a workflow setup problem, the IT assistant does not open
 * an AI Builder session. It asks the console's workflow assistant to prepare a change to the workflow (a field mapped
 * to the wrong place, a setting left empty) and keeps it as a request waiting for a person. The person opens the
 * workflow, sees the change in plain words, and applies or dismisses it in the editor. Nothing is applied for them.
 *
 * The console runs the workflow assistant (it holds the model connection and the editor), so this app asks it over
 * HTTP with a shared secret, and later asks how the proposal ended up.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { looksPlain, whereLabel } from "./plain";
import type { Classification } from "./classify";
import { resolveErrorsFor } from "./errors";
import { createItRequest } from "./index";

const SYSTEM: Actor = { type: "SYSTEM", label: "IT assistant" };

export type ProposalState = "PENDING" | "APPLIED" | "DISMISSED";

export interface FixAsk {
  definitionId: string;
  nodeId?: string | null;
  /** Plain words. Shown to people in the editor. */
  problem: string;
  /** Technical detail from the error. Handed to the model as data only. */
  evidence?: string | null;
  sourceKey: string;
}

export type FixAnswer = { ok: true; id: string; summary: string; reused: boolean } | { ok: false; reason: string };

/** The console's side of the workflow assistant, as this app uses it. */
export interface WorkflowFixClient {
  propose(ask: FixAsk): Promise<FixAnswer>;
  /** How each proposal stands. A proposal that is gone (its workflow was deleted) is missing from the answer. */
  states(ids: string[]): Promise<{ id: string; state: ProposalState }[]>;
  dismiss(id: string): Promise<void>;
}

/** Null until both the console's address and the shared secret are set. */
export function workflowFixClientFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): WorkflowFixClient | null {
  const base = env.WORKFLOW_FIX_URL?.replace(/\/+$/, "");
  const secret = env.WORKFLOW_FIX_SECRET;
  if (!base || !secret) return null;
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  const url = `${base}/api/assistant/propose-fix`;
  return {
    async propose(ask) {
      const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(ask), signal: AbortSignal.timeout(280_000) });
      if (!res.ok) return { ok: false, reason: `The console answered ${res.status}` };
      const body = (await res.json()) as FixAnswer;
      return body && typeof body === "object" && "ok" in body ? body : { ok: false, reason: "The console's answer was not understood" };
    },
    async states(ids) {
      if (ids.length === 0) return [];
      const res = await fetchImpl(`${url}?ids=${encodeURIComponent(ids.join(","))}`, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`The console answered ${res.status}`);
      const body = (await res.json()) as { proposals?: { id: string; status: ProposalState }[] };
      return (body.proposals ?? []).map((p) => ({ id: p.id, state: p.status }));
    },
    async dismiss(id) {
      const res = await fetchImpl(url, { method: "PUT", headers, body: JSON.stringify({ id, action: "dismissed" }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`The console answered ${res.status}`);
    },
  };
}

// ---- finding the workflow ----------------------------------------------------------------------------------------

export interface Failure {
  definitionId: string;
  nodeId: string | null;
}

/**
 * Which workflow and step a captured error came from, using the run it happened in. The run's id is kept with the error
 * when it is captured. Null when that is not known or the run has gone from the console.
 */
export async function locateFailure(context: unknown, find: RunLookup = findRun): Promise<Failure | null> {
  const instanceId = (context as { instanceId?: unknown } | null)?.instanceId;
  if (typeof instanceId !== "string" || !instanceId) return null;
  // The id may be Temporal's workflow id ("instance-<id>") or the run's own id.
  return find(instanceId.replace(/^instance-/, ""), instanceId);
}

/** Finds a run by its own id or by Temporal's workflow id. Replaceable so tests need no console tables. */
export type RunLookup = (id: string, temporalWorkflowId: string) => Promise<Failure | null>;

const findRun: RunLookup = async (id, temporalWorkflowId) => {
  const run = await prisma.workflowInstance.findFirst({ where: { OR: [{ id }, { temporalWorkflowId }] }, select: { definitionId: true, currentNodeId: true } });
  return run ? { definitionId: run.definitionId, nodeId: run.currentNodeId } : null;
};

// ---- asking -----------------------------------------------------------------------------------------------------

export interface WorkflowFixDecision {
  opened: boolean;
  reason?: string;
  requestId?: string;
}

/** Words for the editor. The classifier's reason is used only when it reads plainly; error text never is. */
export function plainProblem(source: string | null, kind: Pick<Classification, "reason">): string {
  const where = whereLabel(null, source);
  const why = looksPlain(kind.reason) ? ` ${kind.reason}` : "";
  return `${where} failed because of how this workflow is set up.${why}`.slice(0, 300);
}

export interface PrepareInput {
  errorId: string;
  maxAttempts: number;
  kind: Classification;
  /** Finds the run an error came from; the console's tables by default. */
  lookup?: RunLookup;
}

/**
 * Asks the workflow assistant for a fix and keeps it as a request. Never opens a second while one waits, and gives up
 * after `maxAttempts` tries for the same error.
 */
export async function openWorkflowFix(input: PrepareInput, client: WorkflowFixClient | null = workflowFixClientFromEnv()): Promise<WorkflowFixDecision> {
  if (!client) return { opened: false, reason: "Workflow fixes are not set up (WORKFLOW_FIX_URL and WORKFLOW_FIX_SECRET)" };
  const err = await appDb.errorEvent.findUniqueOrThrow({ where: { id: input.errorId } });

  const earlier = await appDb.itRequest.findMany({ where: { sourceType: "error", sourceId: input.errorId }, select: { id: true, status: true } });
  const waiting = earlier.find((r) => r.status === "PROPOSED");
  if (waiting) return { opened: false, reason: "A prepared fix is already waiting for review", requestId: waiting.id };
  if (earlier.length >= input.maxAttempts) return { opened: false, reason: `Already tried ${earlier.length} times; a person should look` };

  const where = await locateFailure(err.context, input.lookup);
  if (!where) return { opened: false, reason: "Could not tell which workflow failed" };

  const attempt = earlier.length + 1;
  const answer = await client.propose({
    definitionId: where.definitionId,
    nodeId: where.nodeId,
    problem: plainProblem(err.source, input.kind),
    evidence: `${err.name}: ${err.message}`.slice(0, 500),
    sourceKey: `it-error:${input.errorId}:${attempt}`,
  });
  if (!answer.ok) {
    await appDb.$transaction((tx) => recordActivity(tx, { actor: SYSTEM, entityType: "errorEvent", entityId: input.errorId, kind: "UPDATED", summary: `No workflow fix prepared: ${answer.reason}`.slice(0, 300) }));
    return { opened: false, reason: answer.reason };
  }

  const { request, created } = await createItRequest(
    {
      kind: "ERROR",
      intent: "bugfix",
      title: `${whereLabel(err.route, err.source)} showed an error`,
      description: `A workflow run failed because of how the workflow is set up. A change to the workflow has been prepared and is waiting for a person to review it in the workflow editor.\n\n${answer.summary}`,
      context: { error: { classification: input.kind.class, source: err.source, count: err.count } },
      sourceType: "error",
      sourceId: input.errorId,
    },
    { actor: SYSTEM },
    { status: "PROPOSED", workflowProposalId: answer.id, workflowId: where.definitionId },
  );
  if (!created) return { opened: false, reason: "An open request already exists for this", requestId: request.id };
  await appDb.$transaction((tx) => recordActivity(tx, { actor: SYSTEM, entityType: "errorEvent", entityId: input.errorId, kind: "UPDATED", summary: `${request.number}: workflow fix prepared (attempt ${attempt}), waiting for review` }));
  return { opened: true, requestId: request.id };
}

// ---- following -------------------------------------------------------------------------------------------------

/** Brings one workflow-fix request up to date with what the person did in the editor. Never throws. */
export async function syncWorkflowFix(id: string, client: WorkflowFixClient | null = workflowFixClientFromEnv()) {
  const row = await appDb.itRequest.findUniqueOrThrow({ where: { id } });
  if (!row.workflowProposalId || row.status !== "PROPOSED" || !client) return row;
  try {
    const found = (await client.states([row.workflowProposalId])).find((p) => p.id === row.workflowProposalId);
    // Gone from the console: its workflow was deleted, so there is nothing left to apply.
    const next = !found ? "CLOSED" : found.state === "APPLIED" ? "APPLIED" : found.state === "DISMISSED" ? "CLOSED" : null;
    if (!next) return row;
    const updated = await appDb.$transaction(async (tx) => {
      const res = await tx.itRequest.updateMany({ where: { id, status: "PROPOSED" }, data: { status: next, lastSyncedAt: new Date(), lastError: !found ? "The workflow no longer exists" : null } });
      if (res.count > 0) {
        const label = next === "APPLIED" ? "fix applied to the workflow" : "fix dismissed";
        await recordActivity(tx, { actor: SYSTEM, entityType: "itRequest", entityId: id, kind: "STATUS_CHANGED", summary: `${row.number}: ${label}` });
      }
      return tx.itRequest.findUniqueOrThrow({ where: { id } });
    });
    if (next === "APPLIED") await resolveErrorsFor(row.number, row.sourceId, new Date(), "Fix applied to the workflow");
    return updated;
  } catch (err) {
    return appDb.itRequest.update({ where: { id }, data: { lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500) } });
  }
}

/** Calls off a prepared fix: the console is told to drop it, and the request closes. */
export async function cancelWorkflowFix(id: string, by: Actor, client: WorkflowFixClient | null = workflowFixClientFromEnv()) {
  const row = await appDb.itRequest.findUniqueOrThrow({ where: { id } });
  if (!row.workflowProposalId || row.status !== "PROPOSED") return row;
  if (client) await client.dismiss(row.workflowProposalId);
  return appDb.$transaction(async (tx) => {
    await tx.itRequest.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "CLOSED", lastSyncedAt: new Date() } });
    await recordActivity(tx, { actor: by, entityType: "itRequest", entityId: id, kind: "UPDATED", summary: `${row.number}: cancelled` });
    return tx.itRequest.findUniqueOrThrow({ where: { id } });
  });
}
