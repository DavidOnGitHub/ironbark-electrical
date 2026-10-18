"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { createInvoiceFromJob, getInvoice, InvoiceLineSchema, issueInvoice, recordDeposit, recordPayment, replaceInvoiceLines, voidInvoice } from "../domain/invoicing";
import { parseMoney } from "../lib/money";
import { afterInvoiceIssued, afterInvoicePaid } from "../automation";
import { ensurePaymentLink } from "../integrations/payments";
import { errorMessage, text, type ActionState } from "./shared";

function refresh(invoiceId?: string, jobId?: string) {
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/invoices");
  revalidatePath("/jobs");
  revalidatePath("/");
}

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const jobId = text(formData, "jobId");
  if (!jobId) return { error: "Missing job." };
  let id: string;
  try {
    id = (await createInvoiceFromJob(jobId, userActor(user))).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(id, jobId);
  redirect(`/invoices/${id}`);
}

export async function saveInvoiceLinesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  try {
    const lines = z.array(InvoiceLineSchema).parse(JSON.parse(text(formData, "lines") ?? "[]"));
    await replaceInvoiceLines(invoiceId, lines, text(formData, "notes"), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
}

export async function issueInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  try {
    const issued = await issueInvoice(invoiceId, userActor(user));
    // An invoice already covered by a deposit is paid at once: skip chasing, go straight to the review request.
    if (issued.status === "PAID") await afterInvoicePaid(invoiceId);
    else await afterInvoiceIssued(invoiceId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
}

export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  const amount = parseMoney(text(formData, "amount"));
  if (amount === null) return { error: "Enter the amount received, like 250 or 250.50." };
  try {
    const invoice = await recordPayment(invoiceId, { amountCents: amount, method: (text(formData, "method") ?? "BANK") as "BANK", reference: text(formData, "reference") }, userActor(user));
    if (invoice.status === "PAID") await afterInvoicePaid(invoiceId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
}

/** One click for the common case: the whole balance arrived by bank transfer. Starts the thank-you and review request. */
export async function markInvoicePaidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  try {
    const current = await getInvoice(invoiceId);
    if (!current) return { error: "Invoice not found." };
    if (current.balanceCents <= 0) return { error: "Nothing is owing on this invoice." };
    const invoice = await recordPayment(invoiceId, { amountCents: current.balanceCents, method: "BANK", reference: text(formData, "reference") || "Direct bank transfer" }, userActor(user));
    if (invoice.status === "PAID") await afterInvoicePaid(invoiceId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true, message: "Marked as paid. The customer is being thanked and asked for a review." };
}

export async function voidInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  try {
    await voidInvoice(invoiceId, text(formData, "reason") ?? "", userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
}

export async function recordDepositAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const jobId = text(formData, "jobId");
  if (!jobId) return { error: "Missing job." };
  const amount = parseMoney(text(formData, "amount"));
  if (amount === null) return { error: "Enter the amount received, like 660 or 660.00." };
  try {
    await recordDeposit(jobId, { amountCents: amount, method: (text(formData, "method") ?? "BANK") as "BANK", reference: text(formData, "reference") }, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(undefined, jobId);
  return { error: null, ok: true };
}

export async function createPaymentLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.INVOICES_WRITE);
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };
  try {
    const link = await ensurePaymentLink(invoiceId, userActor(user));
    if (!link.created) return { error: "No payment link: the invoice is not awaiting payment, or Stripe is not set up (add STRIPE_SECRET_KEY)." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
}
