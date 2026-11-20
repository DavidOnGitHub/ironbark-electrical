/**
 * What the business pays for a change request, in credits. A credit is what the business pays for roughly US$10 of work,
 * developer effort and margin included, so it is a price, not the assistant's running cost (that is in costUsd).
 *
 * The assistant sizes each plan (xs, s, m, l, xl) by fixed rules while writing it, and the size sets a fixed price here.
 * The price is charged when the Owner or Office approves the plan and does not change after that, whatever the build
 * costs. It counts against the month the plan was approved in, and is given back if the request closes or fails without
 * the change being made. An xl plan has no price: a developer has to quote it, so it cannot be approved from Ironbark.
 *
 * Each month the business has a number of credits for change requests. That will come from the customer's tier; until
 * tiers exist, IT_FEATURE_CREDITS_PER_MONTH stands in for it (unset: no limit). Error fixes and security fixes are not
 * paid in credits: they have their own budget in dollars (budget.ts).
 */
import type { Prisma } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { creditsFor, creditText, type EstimateSize } from "./pricing";

export * from "./pricing";

type Env = Record<string, string | undefined>;
type Db = Prisma.TransactionClient | typeof appDb;

/** The first day of the month (UTC). */
export const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * The month's credits for change requests, or null for no limit. The seam for the customer's tier: when tiers are
 * built, this reads the tier instead of the environment.
 */
export function featureCreditsPerMonth(env: Env = process.env): number | null {
  const raw = env.IT_FEATURE_CREDITS_PER_MONTH?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Requests that ended without the change being made: their credits are given back. */
const REFUNDED = ["CLOSED", "FAILED"] as const;

/** Credits charged in the month (by when the plan was approved), not counting those given back. */
export async function creditsUsedInMonth(monthOf: Date, db: Db = appDb): Promise<number> {
  const from = monthStart(monthOf);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const r = await db.itRequest.aggregate({
    _sum: { credits: true },
    where: { kind: "FEATURE", creditsChargedAt: { gte: from, lt: to }, status: { notIn: [...REFUNDED] } },
  });
  return r._sum.credits ?? 0;
}

export interface CreditBalance {
  /** Null when there is no limit. */
  allowance: number | null;
  used: number;
  /** Null when there is no limit. */
  left: number | null;
}

export async function creditBalance(env: Env = process.env, now: Date = new Date(), db: Db = appDb): Promise<CreditBalance> {
  const allowance = featureCreditsPerMonth(env);
  const used = await creditsUsedInMonth(now, db);
  return { allowance, used, left: allowance === null ? null : Math.max(0, allowance - used) };
}

/** Why no new change request can start right now (none of the month's credits are left), or null when one may. */
export async function creditPause(env: Env = process.env, now: Date = new Date()): Promise<string | null> {
  const b = await creditBalance(env, now);
  if (b.left === null || b.left > 0) return null;
  return `This month's ${b.allowance} change request credits are used up. New change requests start next month.`;
}

export class CreditError extends Error {}

/** One lock for every charge, so two approvals at once cannot both spend the last credits. */
const CHARGE_LOCK = 7_310_221;

/**
 * Charges a change request its price, inside the caller's transaction. Refuses (CreditError) when the month's credits
 * do not cover it. Charging again a request that is already charged keeps its first price.
 */
export async function chargeCredits(tx: Prisma.TransactionClient, id: string, size: EstimateSize, env: Env = process.env, now: Date = new Date()): Promise<number> {
  const credits = creditsFor(size);
  if (credits === null) throw new CreditError("This change is too large to price here. A developer needs to look at it and quote it.");
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${CHARGE_LOCK}::bigint)`;
  const row = await tx.itRequest.findUniqueOrThrow({ where: { id }, select: { credits: true, creditsChargedAt: true } });
  if (row.creditsChargedAt && row.credits !== null) return row.credits;
  const b = await creditBalance(env, now, tx);
  if (b.left !== null && credits > b.left) {
    throw new CreditError(`This change costs ${creditText(credits)}, but only ${b.left} of this month's ${b.allowance} credits ${b.left === 1 ? "is" : "are"} left. Make the change smaller, or approve it next month.`);
  }
  await tx.itRequest.update({ where: { id }, data: { estimateSize: size, credits, creditsChargedAt: now } });
  return credits;
}

/** Takes a charge back, for an approval that did not go through. */
export async function uncharge(id: string): Promise<void> {
  await appDb.itRequest.update({ where: { id }, data: { credits: null, creditsChargedAt: null, estimateSize: null } });
}
