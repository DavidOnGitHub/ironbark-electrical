/**
 * The month's budget for the IT assistant's AI Builder work (IT_MONTHLY_BUDGET_USD; no budget when unset). Once the month's
 * spend reaches it, no new request is started (a person's change request, an error fix or a security fix) until the next
 * month or until the Owner raises it. Work already under way is not stopped (each fix still has its own cost cap), and a
 * revert is always allowed to start: undoing a change that broke something must never wait on money.
 *
 * Only AI Builder sessions are counted. The AI review, triage and classification calls go straight to the model and are not.
 * Months are calendar months in UTC.
 */
import { appDb } from "../../db/app";

type Env = Record<string, string | undefined>;

/** The monthly budget in dollars, or null when none is set or the value is unusable. */
export function monthlyBudgetUsd(env: Env = process.env): number | null {
  const raw = env.IT_MONTHLY_BUDGET_USD?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export interface MonthUsage {
  /** First day of the month. */
  month: Date;
  spent: number;
  requests: number;
  byKind: { kind: "FEATURE" | "ERROR" | "FINDING"; spent: number; requests: number }[];
}

const KINDS = ["FEATURE", "ERROR", "FINDING"] as const;

/** What the month's requests have cost so far, by kind. A request counts in the month it was made. */
export async function usageForMonth(monthOf: Date): Promise<MonthUsage> {
  const from = monthStart(monthOf);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const rows = await appDb.itRequest.groupBy({ by: ["kind"], where: { createdAt: { gte: from, lt: to } }, _sum: { costUsd: true }, _count: { _all: true } });
  const byKind = KINDS.map((kind) => {
    const r = rows.find((x) => x.kind === kind);
    return { kind, spent: Number(r?._sum.costUsd ?? 0), requests: r?._count._all ?? 0 };
  });
  return { month: from, spent: byKind.reduce((s, k) => s + k.spent, 0), requests: byKind.reduce((s, k) => s + k.requests, 0), byKind };
}

/** This month and the months before it, newest first. */
export async function usageHistory(months = 3, now: Date = new Date()): Promise<MonthUsage[]> {
  const out: MonthUsage[] = [];
  for (let i = 0; i < months; i++) out.push(await usageForMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

export interface BudgetPause {
  reason: string;
  budget: number;
  spent: number;
  /** The month the budget ran out in (first day, UTC). */
  month: Date;
}

/** Why no new request can start right now, or null when one may. */
export async function budgetPause(env: Env = process.env, now: Date = new Date()): Promise<BudgetPause | null> {
  const budget = monthlyBudgetUsd(env);
  if (budget === null) return null;
  const { spent } = await usageForMonth(now);
  if (spent < budget) return null;
  return { budget, spent, month: monthStart(now), reason: `This month's budget of $${budget.toFixed(2)} is used up ($${spent.toFixed(2)} so far). New requests start next month, or when the Owner raises the budget.` };
}
