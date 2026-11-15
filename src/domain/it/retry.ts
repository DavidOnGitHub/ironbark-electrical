/**
 * A fix that did not work (the assistant could not build it) leaves its finding marked "being fixed" with a dead request.
 * These put it back: one finding at a time, or all of them at once, after which the queue works through them one by one.
 * Owner and Office only. Resuming also lifts the pause that three failures in a row cause.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import { delegatedRoleFor, type AiBuilderClient } from "./aiBuilder";
import { defaultClient } from "./index";
import { laneBusy } from "./lane";
import { markSecurityResumed } from "./pause";
import { ItActionError, type Responder } from "./respond";
import { openFindingFix, openNextFindingFix, type FindingFixResult } from "./triage";
import type { ItStatusValue } from "./status";

/** The request ended without producing a change worth accepting. */
export const FIX_FAILED: ItStatusValue[] = ["BUILD_FAILED", "FAILED"];

const mayDecide = (who: Responder) => delegatedRoleFor(who.roles) === "approver";

export interface FailedFix {
  findingId: string;
  requestId: string;
  requestNumber: string;
}

/** Findings marked "being fixed" whose request has failed. */
export async function listFailedFixes(): Promise<FailedFix[]> {
  const fixing = await appDb.finding.findMany({ where: { status: "FIXING", itRequestId: { not: null } }, select: { id: true, itRequestId: true } });
  if (fixing.length === 0) return [];
  const requests = await appDb.itRequest.findMany({ where: { id: { in: fixing.map((f) => f.itRequestId!) }, status: { in: FIX_FAILED } }, select: { id: true, number: true } });
  const byId = new Map(requests.map((r) => [r.id, r.number]));
  return fixing.filter((f) => byId.has(f.itRequestId!)).map((f) => ({ findingId: f.id, requestId: f.itRequestId!, requestNumber: byId.get(f.itRequestId!)! }));
}

/**
 * Puts findings back as open. Their dead requests are closed first: a failed request still counts as open for the same
 * source, so a new one would otherwise be refused as a duplicate (and the assistant could still pick the old one up).
 * One request can serve several findings (advisories against the same package), and they all go back together.
 */
async function reopen(failed: FailedFix[], who: Responder): Promise<void> {
  const requests = new Map(failed.map((f) => [f.requestId, f.requestNumber]));
  await appDb.$transaction(async (tx) => {
    for (const [requestId, number] of requests) {
      await tx.itRequest.update({ where: { id: requestId }, data: { status: "CLOSED" } });
      await recordActivity(tx, { actor: who.actor, entityType: "itRequest", entityId: requestId, kind: "STATUS_CHANGED", summary: `${number}: closed so the fix can be tried again` });
      const linked = await tx.finding.findMany({ where: { itRequestId: requestId, status: "FIXING" }, select: { id: true } });
      for (const f of linked) {
        await tx.finding.update({ where: { id: f.id }, data: { status: "OPEN", itRequestId: null } });
        await recordActivity(tx, { actor: who.actor, entityType: "finding", entityId: f.id, kind: "REOPENED", summary: `Fix retried after ${number} failed` });
      }
    }
  });
}

/** Tries one failed fix again now. Needs the security lane to be free. */
export async function retryFindingFix(findingId: string, who: Responder, client: AiBuilderClient | null = defaultClient(), env: Record<string, string | undefined> = process.env): Promise<FindingFixResult> {
  if (!mayDecide(who)) throw new ItActionError("Only the Owner or Office can do this.");
  const failed = (await listFailedFixes()).find((f) => f.findingId === findingId);
  if (!failed) throw new ItActionError("That fix has not failed, or the finding is no longer waiting on it.");
  const ahead = await laneBusy("FINDING", env);
  if (ahead) throw new ItActionError(`Another fix is under way (${ahead.number}). Try again when it has finished.`);
  await reopen([failed], who);
  await markSecurityResumed(who.actor);
  return openFindingFix(findingId, client, env);
}

/** Puts every failed fix back in line and lifts the pause; the queue then takes them one at a time. Returns how many. */
export async function retryFailedFixes(who: Responder, client: AiBuilderClient | null = defaultClient(), env: Record<string, string | undefined> = process.env): Promise<number> {
  if (!mayDecide(who)) throw new ItActionError("Only the Owner or Office can do this.");
  const failed = await listFailedFixes();
  await reopen(failed, who);
  await markSecurityResumed(who.actor);
  if (failed.length > 0) await openNextFindingFix(client, env);
  return failed.length;
}

/** Lifts the pause without retrying anything: failures before now stop counting. */
export async function resumeSecurityFixes(who: Responder, client: AiBuilderClient | null = defaultClient(), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!mayDecide(who)) throw new ItActionError("Only the Owner or Office can do this.");
  await markSecurityResumed(who.actor);
  await openNextFindingFix(client, env);
}
