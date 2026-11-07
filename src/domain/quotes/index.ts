/**
 * Quotes module - the public API: building a quote from the price list,
 * the draft -> sent -> approved/declined lifecycle, and what approval sets off
 * (a job; the enquiry moves to Won). Totals come from calc.ts, the one place
 * the money rules live.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appDb, type Db, type Prisma } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { createJobFromQuote } from "../jobs";
import { canTransition, changeStatus as changeRequestStatus, getRequest } from "../requests";
import { addDays, computeTotals, effectiveQuoteStatus, lineTotalCents, QUOTE_STATUS_LABEL, VALIDITY_DAYS, type QuoteStatusValue } from "./calc";
import { formatMoney } from "../../lib/money";

export * from "./calc";
export * from "./suggest";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

async function nextQuoteNumber(tx: Db): Promise<string> {
  const row = await tx.sequence.upsert({ where: { key: "quote" }, create: { key: "quote", value: 1001 }, update: { value: { increment: 1 } } });
  return `Q-${row.value}`;
}

const actorId = (actor: Actor) => (actor.type === "USER" ? actor.userId : actor.label);

export const NewQuoteSchema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  siteId: z.preprocess(blank, z.string().optional()),
  requestId: z.preprocess(blank, z.string().optional()),
  title: z.string().trim().min(1, "A title is required").max(200),
  notes: z.preprocess(blank, z.string().trim().max(2000).optional()),
});
export type NewQuoteInput = z.input<typeof NewQuoteSchema>;

export async function createQuote(input: NewQuoteInput, actor: Actor) {
  const v = NewQuoteSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const number = await nextQuoteNumber(tx);
    const quote = await tx.quote.create({
      data: {
        number,
        clientId: v.clientId,
        siteId: v.siteId ?? null,
        requestId: v.requestId ?? null,
        title: v.title,
        notes: v.notes ?? null,
        validUntil: addDays(new Date(), VALIDITY_DAYS),
        createdByUserId: actorId(actor),
      },
    });
    await recordActivity(tx, { actor, entityType: "quote", entityId: quote.id, clientId: quote.clientId, kind: "CREATED", summary: `Quote ${number} drafted: ${quote.title}` });
    return quote;
  });
}

export const QuoteLineSchema = z.object({
  priceItemId: z.preprocess(blank, z.string().optional()),
  description: z.string().trim().min(1, "Every line needs a description").max(300),
  quantity: z.number().positive("Quantity must be more than zero").max(10_000),
  unit: z.string().trim().min(1).max(20).default("each"),
  unitPriceCents: z.number().int().min(0).max(100_000_00),
});
export type QuoteLineInput = z.input<typeof QuoteLineSchema>;

/** Replaces all lines of a DRAFT quote and recomputes totals and the deposit rule. */
export async function replaceQuoteLines(quoteId: string, lines: QuoteLineInput[], actor: Actor) {
  const parsed = z.array(QuoteLineSchema).max(60, "A quote can have up to 60 lines").parse(lines);
  return appDb.$transaction(async (tx) => {
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    if (current.status !== "DRAFT") throw new Error("Only a draft quote can be edited.");
    const totals = computeTotals(parsed.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents })));
    await tx.quoteLine.deleteMany({ where: { quoteId } });
    if (parsed.length > 0) {
      await tx.quoteLine.createMany({
        data: parsed.map((l, i) => ({
          quoteId,
          position: i,
          priceItemId: l.priceItemId ?? null,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceCents: l.unitPriceCents,
          lineTotalCents: lineTotalCents(l.quantity, l.unitPriceCents),
        })),
      });
    }
    const quote = await tx.quote.update({ where: { id: quoteId }, data: totals });
    await recordActivity(tx, {
      actor,
      entityType: "quote",
      entityId: quoteId,
      clientId: quote.clientId,
      kind: "UPDATED",
      summary: `Quote ${quote.number} updated: ${parsed.length} ${parsed.length === 1 ? "line" : "lines"}, ${formatMoney(totals.totalCents)} incl GST`,
    });
    return quote;
  });
}

export async function updateQuoteDetails(quoteId: string, input: { title: string; notes?: string; siteId?: string }, actor: Actor) {
  const v = NewQuoteSchema.pick({ title: true, notes: true, siteId: true }).parse(input);
  return appDb.$transaction(async (tx) => {
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    if (current.status !== "DRAFT") throw new Error("Only a draft quote can be edited.");
    const quote = await tx.quote.update({ where: { id: quoteId }, data: { title: v.title, notes: v.notes ?? null, siteId: v.siteId ?? null } });
    await recordActivity(tx, { actor, entityType: "quote", entityId: quoteId, clientId: quote.clientId, kind: "UPDATED", summary: `Quote ${quote.number} details updated` });
    return quote;
  });
}

export async function getQuote(id: string) {
  const quote = await appDb.quote.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, client: true, site: true, request: { select: { id: true, summary: true, description: true, status: true } }, job: { select: { id: true, number: true, status: true } } },
  });
  return quote ? withEffectiveStatus(quote) : null;
}

export interface QuoteListFilter {
  status?: QuoteStatusValue;
  clientId?: string;
  requestId?: string;
  limit?: number;
}

export async function listQuotes(filter: QuoteListFilter = {}) {
  const now = new Date();
  const where: Prisma.QuoteWhereInput = { ...(filter.clientId ? { clientId: filter.clientId } : {}), ...(filter.requestId ? { requestId: filter.requestId } : {}) };
  if (filter.status === "EXPIRED") Object.assign(where, { status: "SENT", validUntil: { lt: now } });
  else if (filter.status === "SENT") Object.assign(where, { status: "SENT", validUntil: { gte: now } });
  else if (filter.status) Object.assign(where, { status: filter.status });
  const rows = await appDb.quote.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 200,
    include: { client: { select: { id: true, name: true } } },
  });
  return rows.map((q) => withEffectiveStatus(q));
}

function withEffectiveStatus<T extends { status: QuoteStatusValue; validUntil: Date }>(quote: T): T & { effectiveStatus: QuoteStatusValue } {
  return { ...quote, effectiveStatus: effectiveQuoteStatus(quote.status, quote.validUntil) };
}

/** Open (sent, still valid) quotes: how many and their total value - for the dashboard. */
export async function openQuoteStats() {
  const agg = await appDb.quote.aggregate({ where: { status: "SENT", validUntil: { gte: new Date() } }, _count: { _all: true }, _sum: { totalCents: true } });
  return { count: agg._count._all, totalCents: agg._sum.totalCents ?? 0 };
}

/**
 * Marks a draft as sent (the person's review is this deliberate click - nothing
 * goes out by itself) and starts the 14-day validity. The enquiry moves to Quoted.
 * Emailing the quote arrives with the quote-and-chase workflow.
 */
export async function markQuoteSent(quoteId: string, actor: Actor) {
  const quote = await appDb.$transaction(async (tx) => {
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { _count: { select: { lines: true } } } });
    if (current.status !== "DRAFT") throw new Error("Only a draft quote can be sent.");
    if (current._count.lines === 0 || current.totalCents <= 0) throw new Error("Add at least one priced line before sending.");
    const now = new Date();
    const updated = await tx.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: now, validUntil: addDays(now, VALIDITY_DAYS) } });
    await recordActivity(tx, {
      actor,
      entityType: "quote",
      entityId: quoteId,
      clientId: updated.clientId,
      kind: "SENT",
      summary: `Quote ${updated.number} sent: ${formatMoney(updated.totalCents)} incl GST, valid to ${updated.validUntil.toLocaleDateString("en-AU")}`,
    });
    return updated;
  });
  await syncRequest(quote.requestId, "QUOTED", actor);
  return quote;
}

/** Moves the linked enquiry when the pipeline allows it; never fails the quote action. */
async function syncRequest(requestId: string | null, to: "QUOTED" | "WON", actor: Actor) {
  if (!requestId) return;
  try {
    const request = await getRequest(requestId);
    if (request && canTransition(request.status, to)) await changeRequestStatus(requestId, to, {}, actor);
  } catch {
    // The quote is the source of truth; a pipeline hiccup must not undo it.
  }
}

export class QuoteDecisionError extends Error {}

/** The customer's answer. Approving creates the job (same transaction) and marks the enquiry Won. */
export async function decideQuote(quoteId: string, decision: "APPROVED" | "DECLINED", note: string | undefined, actor: Actor) {
  const result = await appDb.$transaction(async (tx) => {
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const effective = effectiveQuoteStatus(current.status, current.validUntil);
    if (effective === "EXPIRED") throw new QuoteDecisionError("This quote has expired. Extend its validity first, then record the answer.");
    if (effective !== "SENT") throw new QuoteDecisionError(`A ${QUOTE_STATUS_LABEL[effective].toLowerCase()} quote cannot be ${decision === "APPROVED" ? "approved" : "declined"}.`);
    const decisionNote = note?.trim() || null;
    const quote = await tx.quote.update({ where: { id: quoteId }, data: { status: decision, decidedAt: new Date(), decisionNote } });
    await recordActivity(tx, {
      actor,
      entityType: "quote",
      entityId: quoteId,
      clientId: quote.clientId,
      kind: decision === "APPROVED" ? "APPROVED" : "DECLINED",
      summary: `Quote ${quote.number} ${decision === "APPROVED" ? "approved" : "declined"} by the customer`,
      body: decisionNote,
    });
    const job =
      decision === "APPROVED"
        ? await createJobFromQuote({ quoteId, clientId: quote.clientId, siteId: quote.siteId, title: quote.title, scope: quote.notes, subtotalCents: quote.subtotalCents }, actor, tx)
        : null;
    return { quote, job };
  });
  if (decision === "APPROVED") await syncRequest(result.quote.requestId, "WON", actor);
  return result;
}

/** Gives a sent (or expired) quote another validity period from now. */
export async function extendQuoteValidity(quoteId: string, days: number, actor: Actor) {
  const n = z.number().int().min(1).max(60).parse(days);
  return appDb.$transaction(async (tx) => {
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    if (current.status !== "SENT") throw new Error("Only a sent quote's validity can be extended.");
    const quote = await tx.quote.update({ where: { id: quoteId }, data: { validUntil: addDays(new Date(), n) } });
    await recordActivity(tx, { actor, entityType: "quote", entityId: quoteId, clientId: quote.clientId, kind: "UPDATED", summary: `Quote ${quote.number} validity extended by ${n} days` });
    return quote;
  });
}

// ---- The customer's accept/decline link ----

const CUSTOMER_LINK_ACTOR: Actor = { type: "SYSTEM", label: "Customer (accept link)" };

/** The base address customers' links point at. */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_BASE_URL || env.AUTH_URL || "http://localhost:3200").replace(/\/+$/, "");
}

export const acceptUrlFor = (token: string, env?: Record<string, string | undefined>) => `${appBaseUrl(env)}/accept/${token}`;

/** The quote's secret link token, created on first use. Only a sent quote gets one - a draft has no link yet. */
export async function ensureAcceptToken(quoteId: string): Promise<string | null> {
  const quote = await appDb.quote.findUnique({ where: { id: quoteId }, select: { status: true, acceptToken: true } });
  if (!quote || quote.status === "DRAFT") return null;
  if (quote.acceptToken) return quote.acceptToken;
  const token = randomBytes(24).toString("base64url");
  // Only fill an empty slot, so two callers at once end up with the same token.
  await appDb.quote.updateMany({ where: { id: quoteId, acceptToken: null }, data: { acceptToken: token } });
  return (await appDb.quote.findUnique({ where: { id: quoteId }, select: { acceptToken: true } }))?.acceptToken ?? null;
}

/** What the customer sees at their link; null for an unknown (or draft) quote. */
export async function getQuoteByToken(token: string) {
  if (!token || token.length < 16) return null;
  const quote = await appDb.quote.findUnique({
    where: { acceptToken: token },
    include: { lines: { orderBy: { position: "asc" } }, client: { select: { name: true } } },
  });
  return quote && quote.status !== "DRAFT" ? withEffectiveStatus(quote) : null;
}

/** The customer's answer from their link. Same rules as the office recording it (sent, not expired), same effects. */
export async function answerQuoteByToken(token: string, decision: "APPROVED" | "DECLINED", reason?: string) {
  const quote = await getQuoteByToken(token);
  if (!quote) throw new QuoteDecisionError("This link is not valid.");
  const text = reason?.trim().slice(0, 1000);
  const note = decision === "APPROVED" ? "Accepted using the link in the quote email" : `Declined using the link in the quote email${text ? `: ${text}` : ""}`;
  return decideQuote(quote.id, decision, note, CUSTOMER_LINK_ACTOR);
}
export * from "./validity";
