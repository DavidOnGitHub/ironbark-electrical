/**
 * When automatic security fixes stop and wait for a person. Two things stop them:
 *   - the last three fixes all failed (a failed build frees the lane at once, so without this the whole backlog is tried
 *     one a minute, each failing for the same reason - which is exactly what happened on the first runs), and
 *   - the day's spending is used up (IT_SECURITY_DAILY_CAP_USD, 10 by default).
 * A person lifts the first by resuming (or retrying), which starts the count again from that moment.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";

export const SECURITY_FAILURE_LIMIT = 3;
export const DEFAULT_SECURITY_DAILY_CAP_USD = 10;
const RESUME_KEY = "security-fix-resume";
const DAY_MS = 86_400_000;

export function securityDailyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.IT_SECURITY_DAILY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SECURITY_DAILY_CAP_USD;
}

export interface SecurityPause {
  kind: "failures" | "cost";
  reason: string;
}

/** Why automatic security fixes are paused right now, or null when they may go on. */
export async function securityPause(env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<SecurityPause | null> {
  const spent = await appDb.itRequest.aggregate({ _sum: { costUsd: true }, where: { kind: "FINDING", createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
  const total = Number(spent._sum.costUsd ?? 0);
  const cap = securityDailyCapUsd(env);
  if (total >= cap) return { kind: "cost", reason: `Automatic security fixes are paused: today's limit of $${cap.toFixed(2)} is used up ($${total.toFixed(2)} so far). They continue tomorrow, or when a person resumes them.` };

  const resumed = await appDb.appFlag.findUnique({ where: { key: RESUME_KEY } });
  const recent = await appDb.itRequest.findMany({
    where: { kind: "FINDING", workflowProposalId: null, ...(resumed ? { createdAt: { gt: resumed.updatedAt } } : {}) },
    orderBy: { createdAt: "desc" },
    take: SECURITY_FAILURE_LIMIT,
    select: { status: true },
  });
  if (recent.length === SECURITY_FAILURE_LIMIT && recent.every((r) => r.status === "BUILD_FAILED" || r.status === "FAILED")) {
    return { kind: "failures", reason: `Automatic security fixes are paused: the last ${SECURITY_FAILURE_LIMIT} all failed. Look at why, then resume them.` };
  }
  return null;
}

/** A person says to carry on: failures before this moment no longer count. */
export async function markSecurityResumed(actor: Actor): Promise<void> {
  await appDb.$transaction(async (tx) => {
    await tx.appFlag.upsert({ where: { key: RESUME_KEY }, create: { key: RESUME_KEY, enabled: true, updatedBy: actor.label }, update: { enabled: true, updatedBy: actor.label } });
    await recordActivity(tx, { actor, entityType: "appFlag", entityId: RESUME_KEY, kind: "UPDATED", summary: "Automatic security fixes resumed" });
  });
}
