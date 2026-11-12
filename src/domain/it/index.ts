/**
 * IT assistant module - the public API. A request is something the business wants changed (asked for, or noticed by
 * the assistant itself: an error or a security finding). Each one is one AI Builder session; this module creates
 * that session and mirrors its progress, so pages and workflows never talk to AI Builder directly.
 * Every change writes an ActivityEvent in the same transaction.
 */
import { z } from "zod";
import type { ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { aiBuilderConfigFromEnv, AiBuilderError, createAiBuilderClient, summarizeSession, type AiBuilderClient } from "./aiBuilder";
import { costCapUsd, filesPushed, overCostCap, protectedFilesIn, PROTECTED_RULES } from "./guardrails";
import { syncWorkflowFix, workflowFixClientFromEnv, type WorkflowFixClient } from "./workflowFix";
import { fromSessionStatus, inDeployPhase, intentFor, IT_DEPLOY_PHASE, IT_STATUS_LABEL, IT_TERMINAL, isTerminal, type ItStatusValue } from "./status";

export * from "./status";
export { aiBuilderConfigFromEnv, AiBuilderError, createAiBuilderClient, delegatedRoleFor, summarizeSession } from "./aiBuilder";
export type { AiBuilderClient, AiBuilderConfig, AiEvent, AiSession, AiSessionDetail, OnBehalfOf } from "./aiBuilder";
export type { ItRequest } from "ironbark-electrical-client";

/** Statuses where the assistant is still spending, so a fix can be stopped for cost. Once a change waits on a person, it is not. */
const STOPPABLE: ItStatusValue[] = ["DRAFTING_SPEC", "BUILDING", "BUILD_FAILED"];

/** A session is created by one process at a time; a claim older than this is assumed to belong to a crashed one. */
const CLAIM_MS = 2 * 60_000;
const MAX_ERROR = 500;

export const NewItRequestSchema = z.object({
  kind: z.enum(["FEATURE", "ERROR", "FINDING"]),
  title: z.string().trim().min(1, "A title is required").max(200),
  description: z.string().trim().min(1, "Describe what you need").max(10_000),
  /** Page context, or the error / finding details. Passed on to the assistant as data. */
  context: z.record(z.string(), z.unknown()).optional(),
  /** What this came from; a repeat of a still-open source reuses its request. */
  sourceType: z.string().trim().min(1).max(40).optional(),
  sourceId: z.string().trim().min(1).max(200).optional(),
  /** Overrides the default AI Builder intent for the kind (for example `maintenance` for a dependency finding). */
  intent: z.enum(["feature", "bugfix", "maintenance"]).optional(),
});
export type NewItRequest = z.input<typeof NewItRequestSchema>;

/** Who asked. `email` lets the assistant credit the person for a request that is started later (a retry). */
export interface Requester {
  actor: Actor;
  email?: string | null;
}

/** The client for the configured AI Builder, or null when none is configured (local development, tests). */
export function defaultClient(env: Record<string, string | undefined> = process.env): AiBuilderClient | null {
  const config = aiBuilderConfigFromEnv(env);
  return config ? createAiBuilderClient(config) : null;
}

const clip = (message: string) => (message.length > MAX_ERROR ? `${message.slice(0, MAX_ERROR - 3)}...` : message);
const errorText = (err: unknown) => clip(err instanceof Error ? err.message : String(err));

/** Opens a request. When it names a source that already has an open request, that one is returned instead. */
export async function createItRequest(
  input: NewItRequest,
  by: Requester,
  /** For a request that is not an AI Builder session: it starts in this state and is never handed to AI Builder. */
  init?: { status: ItStatusValue; workflowProposalId: string; workflowId: string },
): Promise<{ request: ItRequest; created: boolean }> {
  const data = NewItRequestSchema.parse(input);
  if (data.sourceType && data.sourceId) {
    const open = await appDb.itRequest.findFirst({
      where: { sourceType: data.sourceType, sourceId: data.sourceId, status: { notIn: IT_TERMINAL } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return { request: open, created: false };
  }
  const request = await appDb.$transaction(async (tx) => {
    const seq = await tx.sequence.upsert({ where: { key: "it" }, create: { key: "it", value: 1001 }, update: { value: { increment: 1 } } });
    const row = await tx.itRequest.create({
      data: {
        number: `IT-${seq.value}`,
        kind: data.kind,
        title: data.title,
        description: data.description,
        context: (data.context as object | undefined) ?? undefined,
        sourceType: data.sourceType ?? null,
        sourceId: data.sourceId ?? null,
        intent: data.intent ?? null,
        ...(init ? { status: init.status, workflowProposalId: init.workflowProposalId, workflowId: init.workflowId } : {}),
        requestedByUserId: by.actor.type === "USER" ? by.actor.userId : null,
        requestedByLabel: by.actor.label,
        requestedByEmail: by.email?.toLowerCase() ?? null,
      },
    });
    await recordActivity(tx, { actor: by.actor, entityType: "itRequest", entityId: row.id, kind: "CREATED", summary: `${row.number} opened: ${row.title}` });
    return row;
  });
  return { request, created: true };
}

/**
 * Creates the AI Builder session for a request. Safe to call again: it does nothing once a session exists or while
 * another process is creating it. A failure is recorded on the request and leaves it SUBMITTED, so the sync retries.
 */
export async function startItRequest(id: string, client: AiBuilderClient | null = defaultClient()): Promise<{ request: ItRequest; started: boolean; reason?: string }> {
  const current = await appDb.itRequest.findUniqueOrThrow({ where: { id } });
  if (current.sessionId) return { request: current, started: false };
  if (!client) return { request: current, started: false, reason: "AI Builder is not configured" };

  const now = new Date();
  const claim = await appDb.itRequest.updateMany({
    where: { id, sessionId: null, OR: [{ startingAt: null }, { startingAt: { lt: new Date(now.getTime() - CLAIM_MS) } }] },
    data: { startingAt: now },
  });
  if (claim.count === 0) return { request: await appDb.itRequest.findUniqueOrThrow({ where: { id } }), started: false, reason: "Already being started" };

  const who = current.requestedByEmail ? { email: current.requestedByEmail, name: current.requestedByLabel, role: "requester" as const } : undefined;
  try {
    const session = await client.createSession(
      {
        intent: intentFor(current.kind, (current.intent as "feature" | "bugfix" | "maintenance" | null) ?? undefined),
        text: `${current.title}\n\n${current.description}`,
        context: {
          itRequest: { id: current.id, number: current.number, kind: current.kind },
          ...((current.context as Record<string, unknown> | null) ?? {}),
          // Only a developer may approve changes under these areas; the assistant should stay out and say so if a fix needs one.
          protectedPaths: PROTECTED_RULES.map((r) => r.label),
        },
      },
      who,
    );
    const request = await appDb.$transaction(async (tx) => {
      const row = await tx.itRequest.update({
        where: { id },
        data: { sessionId: session.id, sessionStatus: session.status, status: fromSessionStatus(session.status), costUsd: session.costUsd, lastError: null, startingAt: null, lastSyncedAt: new Date() },
      });
      await recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "itRequest", entityId: id, kind: "UPDATED", summary: `${row.number} handed to the assistant` });
      return row;
    });
    return { request, started: true };
  } catch (err) {
    const reason = errorText(err);
    const request = await appDb.itRequest.update({ where: { id }, data: { lastError: reason, startingAt: null } });
    return { request, started: false, reason };
  }
}

/** Opens a request and hands it to the assistant straight away. */
export async function submitItRequest(input: NewItRequest, by: Requester, client: AiBuilderClient | null = defaultClient()) {
  const { request, created } = await createItRequest(input, by);
  if (!created) return { request, created, started: false as boolean, reason: "An open request already exists for this" as string | undefined };
  const started = await startItRequest(request.id, client);
  return { request: started.request, created, started: started.started, reason: started.reason };
}

/** Mirrors one request from its AI Builder session. Records a failure on the request instead of throwing. */
export async function syncItRequest(id: string, client: AiBuilderClient | null = defaultClient(), fixClient?: WorkflowFixClient | null): Promise<ItRequest | null> {
  const row = await appDb.itRequest.findUnique({ where: { id } });
  if (!row || isTerminal(row.status) || inDeployPhase(row.status)) return row;
  // A prepared workflow fix has no AI Builder session: the person's choice in the editor is what is followed.
  if (row.workflowProposalId) return syncWorkflowFix(id, fixClient);
  if (!row.sessionId) return (await startItRequest(id, client)).request;
  if (!client) return row;

  try {
    const detail = await client.getSession(row.sessionId);
    const summary = summarizeSession(detail);
    const status = fromSessionStatus(summary.status);

    // Cost cap: an automated fix that has spent too much is stopped, not left to keep going.
    if (overCostCap(row.kind, summary.costUsd) && STOPPABLE.includes(status)) {
      const reason = `Stopped: this fix has cost $${summary.costUsd.toFixed(2)}, over the $${costCapUsd().toFixed(2)} limit. A developer should look.`;
      const who = row.requestedByEmail ? { email: row.requestedByEmail, name: row.requestedByLabel, role: "approver" as const } : { email: "it-assistant@system.local", name: "IT assistant", role: "approver" as const };
      try {
        await client.cancel(row.sessionId, who);
      } catch (err) {
        // Not stopped: say so and try again next time round, rather than pretend.
        return appDb.itRequest.update({ where: { id }, data: { costUsd: summary.costUsd, lastError: `Over the cost limit but could not be stopped: ${errorText(err)}`, lastSyncedAt: new Date() } });
      }
      return appDb.$transaction(async (tx) => {
        const stopped = await tx.itRequest.update({ where: { id }, data: { status: "FAILED", sessionStatus: "closed", costUsd: summary.costUsd, lastError: reason, lastSyncedAt: new Date() } });
        await recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "itRequest", entityId: id, kind: "STATUS_CHANGED", summary: `${row.number}: ${reason}` });
        return stopped;
      });
    }

    const protectedFiles = protectedFilesIn(filesPushed(detail.events));
    const newlyProtected = protectedFiles.length > 0 && !row.needsDeveloper;
    return await appDb.$transaction(async (tx) => {
      const updated = await tx.itRequest.update({
        where: { id },
        data: {
          status,
          ...(status === "MERGED" && !row.mergedAt ? { mergedAt: new Date() } : {}),
          sessionStatus: summary.status,
          prUrl: summary.prUrl,
          previewUrl: summary.previewUrl,
          costUsd: summary.costUsd,
          lastError: null,
          lastSyncedAt: new Date(),
          needsDeveloper: protectedFiles.length > 0,
          protectedFiles,
        },
      });
      if (newlyProtected) {
        await recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "itRequest", entityId: id, kind: "UPDATED", summary: `${row.number} touches protected files (${protectedFiles.slice(0, 3).join(", ")}); a developer must review it` });
      }
      if (status !== row.status) {
        await recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "itRequest", entityId: id, kind: "STATUS_CHANGED", summary: `${row.number}: ${IT_STATUS_LABEL[status]}` });
      }
      return updated;
    });
  } catch (err) {
    // The session was deleted on the AI Builder side: there is nothing left to follow.
    if (err instanceof AiBuilderError && err.status === 404) {
      return appDb.itRequest.update({ where: { id }, data: { status: "FAILED", lastError: "The assistant's work could not be found any more", lastSyncedAt: new Date() } });
    }
    return appDb.itRequest.update({ where: { id }, data: { lastError: errorText(err) } });
  }
}

/** Syncs every request that can still change. One failing request never stops the rest. */
export async function syncOpenItRequests(client: AiBuilderClient | null = defaultClient(), limit = 100, fixClient?: WorkflowFixClient | null): Promise<{ checked: number; changed: number }> {
  if (!client && !(fixClient === undefined ? workflowFixClientFromEnv() : fixClient)) return { checked: 0, changed: 0 };
  const open = await appDb.itRequest.findMany({ where: { status: { notIn: [...IT_TERMINAL, ...IT_DEPLOY_PHASE] } }, orderBy: { createdAt: "asc" }, take: limit });
  let changed = 0;
  for (const row of open) {
    const after = await syncItRequest(row.id, client, fixClient);
    if (after && after.status !== row.status) changed++;
  }
  return { checked: open.length, changed };
}

export function getItRequest(id: string) {
  return appDb.itRequest.findUnique({ where: { id } });
}

export function listItRequests(opts: { status?: ItStatusValue[]; kind?: "FEATURE" | "ERROR" | "FINDING"; limit?: number } = {}) {
  return appDb.itRequest.findMany({
    where: { ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
  });
}

export * from "./conversation";
export * from "./respond";

export * from "./deploy";
export * from "./errors";
export * from "./feed";
export * from "./classify";
export * from "./guardrails";
export * from "./workflowFix";
export * from "./revertGuard";
export * from "./fixSummary";
export * from "./plain";
export * from "./security";
export * from "./triage";
export * from "./scanNow";
