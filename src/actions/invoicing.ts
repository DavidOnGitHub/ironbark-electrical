"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { createInvoiceFromJob, InvoiceLineSchema, issueInvoice, recordDeposit, recordPayment, replaceInvoiceLines, voidInvoice } from "../domain/invoicing";
import { parseMoney } from "../lib/money";
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
    await issueInvoice(invoiceId, userActor(user));
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
    await recordPayment(invoiceId, { amountCents: amount, method: (text(formData, "method") ?? "BANK") as "BANK", reference: text(formData, "reference") }, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(invoiceId);
  return { error: null, ok: true };
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
