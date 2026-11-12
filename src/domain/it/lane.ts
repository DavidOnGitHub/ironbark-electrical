/**
 * Automated fixes wait their turn. Two open changes that touch the same lines (or both rewrite the lockfile) collide
 * when the second is accepted, and nothing resolves that by itself. So errors get one lane and security findings
 * another, and a lane opens its next request only when nothing in it is still in flight. Lanes are separate so that a
 * security fix waiting for a person never holds back the fix for a live error. Requests people ask for are not held.
 * IT_FIX_QUEUE=off lets automated fixes run side by side again.
 */
import type { ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import type { ItStatusValue } from "./status";

export type Lane = "ERROR" | "FINDING";

/**
 * A request is in flight until its change is merged or it stops. A merged change (deploying) no longer has an open
 * branch, a failed build has no open pull request to collide with, and a prepared workflow fix changes no code.
 */
export const IN_FLIGHT: ItStatusValue[] = ["SUBMITTED", "DRAFTING_SPEC", "NEEDS_ANSWERS", "SPEC_REVIEW", "BUILDING", "PR_OPEN", "ACCEPTED"];

export const fixQueueOn = (env: Record<string, string | undefined> = process.env): boolean => env.IT_FIX_QUEUE?.trim().toLowerCase() !== "off";

/** The request holding the lane right now, or null when it is free (or queuing is switched off). */
export async function laneBusy(lane: Lane, env: Record<string, string | undefined> = process.env): Promise<ItRequest | null> {
  if (!fixQueueOn(env)) return null;
  return appDb.itRequest.findFirst({ where: { kind: lane, workflowProposalId: null, status: { in: IN_FLIGHT } }, orderBy: { createdAt: "asc" } });
}
