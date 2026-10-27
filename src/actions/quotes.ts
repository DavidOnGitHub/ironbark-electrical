"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import {
  createQuote,
  decideQuote,
  extendQuoteValidity,
  getQuote,
  markQuoteSent,
  QuoteLineSchema,
  replaceQuoteLines,
  suggestLines,
  type SuggestResult,
  updateQuoteDetails,
} from "../domain/quotes";
import { afterQuoteSent, rejectStaleQuoteApprovals, stopQuoteChase } from "../automation";
import { isAllowedRecipient } from "../integrations/allowlist";
import { bundleLines, listBundles, listPriceItems } from "../domain/pricing";
import { errorMessage, text, type ActionState } from "./shared";

export async function createQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.QUOTES_WRITE);
  let id: string;
  try {
    const quote = await createQuote(
      {
        clientId: text(formData, "clientId") ?? "",
        siteId: text(formData, "siteId"),
        requestId: text(formData, "requestId"),
        title: text(formData, "title") ?? "",
        notes: text(formData, "notes"),
      },
      userActor(user),
    );
    id = quote.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/quotes");
  redirect(`/quotes/${id}`);
}

export async function saveQuoteLinesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.QUOTES_WRITE);
  const quoteId = text(formData, "quoteId");
  if (!quoteId) return { error: "Missing quote." };
  try {
    const raw = JSON.parse(text(formData, "lines") ?? "[]");
    const lines = z.array(QuoteLineSchema).parse(raw);
    await replaceQuoteLines(quoteId, lines, userActor(user));
    const title = text(formData, "title");
    if (title !== undefined) await updateQuoteDetails(quoteId, { title, notes: text(formData, "notes"), siteId: text(formData, "siteId") }, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { error: null, ok: true };
}

/** What actually happens after "Send quote", in words the office can trust. */
function sendOutcome(started: boolean, email: string): string {
  if (!started) return "The quote is now Sent, but nothing was emailed: the quote automation is off or not published. Send it to the customer yourself.";
  if (email === "") return "Quote sent. The customer has no email address, so a task asks someone to send it.";
  if (!isAllowedRecipient(email)) return "Quote sent. It is waiting for approval in Tasks and goes to the customer once approved.";
  return "Quote sent to the customer. We will remind them if they have not answered.";
}

export async function markQuoteSentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.QUOTES_WRITE);
  const quoteId = text(formData, "quoteId");
  if (!quoteId) return { error: "Missing quote." };
  try {
    await markQuoteSent(quoteId, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  // The quote-and-chase workflow (if published) takes it from here; a failure to start it never undoes the send.
  // An earlier "check the draft quote" approval is now out of date: reject it so only the new task is left pending.
  await rejectStaleQuoteApprovals(quoteId);
  const started = await afterQuoteSent(quoteId);
  const email = (await getQuote(quoteId))?.client.email ?? "";
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  revalidatePath("/requests");
  revalidatePath("/");
  return { error: null, ok: true, message: sendOutcome(started.started, email) };
}

export async function decideQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.QUOTES_WRITE);
  const quoteId = text(formData, "quoteId");
  const decision = text(formData, "decision");
  if (!quoteId || (decision !== "APPROVED" && decision !== "DECLINED")) return { error: "Choose approve or decline." };
  let jobId: string | null = null;
  try {
    const { job } = await decideQuote(quoteId, decision, text(formData, "note"), userActor(user));
    jobId = job?.id ?? null;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  await stopQuoteChase(quoteId);
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  revalidatePath("/jobs");
  revalidatePath("/requests");
  revalidatePath("/");
  if (jobId) redirect(`/jobs/${jobId}`);
  return { error: null, ok: true };
}

export async function extendQuoteValidityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.QUOTES_WRITE);
  const quoteId = text(formData, "quoteId");
  if (!quoteId) return { error: "Missing quote." };
  try {
    await extendQuoteValidity(quoteId, Number(text(formData, "days") ?? "14"), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { error: null, ok: true };
}

/** Suggested price-list lines for an enquiry's wording. Read-only: the office reviews them before anything is added.
 * Uses the AI when ANTHROPIC_API_KEY is set (it can only choose price-list entries), keyword matching otherwise. */
export async function suggestQuoteLinesAction(description: string): Promise<SuggestResult> {
  await requireRole(Access.QUOTES_WRITE);
  const [items, bundles] = await Promise.all([listPriceItems({ activeOnly: true }), listBundles({ activeOnly: true })]);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return suggestLines(
    description,
    items.map((i) => ({ id: i.id, name: i.name, description: i.description, kind: i.kind, unit: i.unit, priceCents: i.priceCents })),
    bundles.map((b) => ({ id: b.id, name: b.name, description: b.description, lines: bundleLines(b) })),
    apiKey ? { apiKey } : undefined,
  );
}
