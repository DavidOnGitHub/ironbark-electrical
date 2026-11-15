/**
 * The day's spending limit for security fixes (IT_SECURITY_DAILY_CAP_USD, 10 by default). Fixes only start when a person
 * chooses them, so a run of failures cannot loop on its own and needs no breaker; this only stops one day's choices from
 * adding up past what the business meant to spend.
 */
import { appDb } from "../../db/app";

export const DEFAULT_SECURITY_DAILY_CAP_USD = 10;
const DAY_MS = 86_400_000;

export function securityDailyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.IT_SECURITY_DAILY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SECURITY_DAILY_CAP_USD;
}

export interface SecurityPause {
  kind: "cost";
  reason: string;
}

/** Why no more security fixes can start right now, or null when they may. */
export async function securityPause(env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<SecurityPause | null> {
  const spent = await appDb.itRequest.aggregate({ _sum: { costUsd: true }, where: { kind: "FINDING", createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
  const total = Number(spent._sum.costUsd ?? 0);
  const cap = securityDailyCapUsd(env);
  if (total >= cap) return { kind: "cost", reason: `Security fixes cannot start: today's limit of $${cap.toFixed(2)} is used up ($${total.toFixed(2)} so far). Try again tomorrow.` };
  return null;
}
