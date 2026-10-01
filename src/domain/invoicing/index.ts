/**
 * Invoicing module - the public API: an invoice drafted from a completed job (quote
 * lines + approved variations, less any deposit already received), reviewed,
 * issued, paid in full or in part, or voided. Money rules live in calc.ts. The
 * payment link and its emails belong to the workflows; this module records what
 * happened and keeps the job's billing status in step.
 */
import { z } from "zod";
import { appDb, type Db, type Prisma } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { setBillingStatus } from "../jobs";
import { addDays, lineTotalCents } from "../quotes/calc";
import { formatMoney } from "../../lib/money";
import {
  balanceDueCents,
  chaseStage,
  daysOverdue,
  effectiveInvoiceStatus,
  invoiceTotals,
  PAYMENT_TERMS_DAYS,
  type EffectiveInvoiceStatus,
  type InvoiceStatusValue,
} from "./calc";

export * from "./calc";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const actorId = (actor: Actor) => (actor.type === "USER" ? actor.userId : actor.label);

async function nextInvoiceNumber(tx: Db): Promise<string> {
  const row = await tx.sequence.upsert({ where: { key: "invoice" }, create: { key: "invoice", value: 3001 }, update: { value: { increment: 1 } } });
  return `INV-${row.value}`;
}

export class InvoiceError extends Error {}

type InvoiceWithPayments = {
  status: InvoiceStatusValue;
  dueAt: Date | null;
  totalCents: number;
  creditCents: number;
  payments: { kind: string; amountCents: number }[];
};

/** Derived figures every screen needs: money received, balance, overdue state. */
export function withInvoiceFigures<T extends InvoiceWithPayments>(invoice: T, now: Date = new Date()) {
  const paidCents = invoice.payments.filter((p) => p.kind === "INVOICE").reduce((sum, p) => sum + p.amountCents, 0);
  const balanceCents = invoice.status === "VOID" || invoice.status === "DRAFT" ? balanceDueCents(invoice.totalCents, invoice.creditCents, 0) : balanceDueCents(invoice.totalCents, invoice.creditCents, paidCents);
  const effectiveStatus: EffectiveInvoiceStatus = effectiveInvoiceStatus(invoice.status, invoice.dueAt, balanceCents, now);
  const overdueDays = effectiveStatus === "OVERDUE" && invoice.dueAt ? daysOverdue(invoice.dueAt, now) : 0;
  return { ...invoice, paidCents, balanceCents, effectiveStatus, daysOverdue: overdueDays, chase: chaseStage(overdueDays) };
}

/** Drafts the invoice for a completed job. Idempotent per job: a second call is an error, not a duplicate. */
export async function createInvoiceFromJob(jobId: string, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { quote: { include: { lines: { orderBy: { position: "asc" } } } }, notes: { where: { kind: "VARIATION", approved: true }, orderBy: { createdAt: "asc" } }, invoices: { where: { status: { not: "VOID" } }, select: { id: true } } },
    });
    if (job.invoices.length > 0) throw new InvoiceError("This job already has an invoice.");
    if (job.status !== "COMPLETED") throw new InvoiceError("Only a completed job can be invoiced.");
    if (!job.quote) throw new InvoiceError("This job has no quote to invoice from.");

    const lines = [
      ...job.quote.lines.map((l) => ({ source: "QUOTE", description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unitPriceCents })),
      ...job.notes.map((n) => ({ source: "VARIATION", description: `Variation: ${n.text}`, quantity: 1, unit: "each", unitPriceCents: n.extraCents ?? 0 })),
    ];
    const deposits = await tx.payment.findMany({ where: { jobId, kind: "DEPOSIT", invoiceId: null } });
    const totals = invoiceTotals(lines, deposits.reduce((sum, p) => sum + p.amountCents, 0));
    const number = await nextInvoiceNumber(tx);
    const invoice = await tx.invoice.create({
      data: {
        number,
        jobId,
        clientId: job.clientId,
        siteId: job.siteId,
        ...totals,
        createdByUserId: actorId(actor),
        lines: { create: lines.map((l, i) => ({ position: i, ...l, lineTotalCents: lineTotalCents(l.quantity, l.unitPriceCents) })) },
      },
    });
    if (deposits.length > 0) await tx.payment.updateMany({ where: { id: { in: deposits.map((d) => d.id) } }, data: { invoiceId: invoice.id } });
    await recordActivity(tx, {
      actor,
      entityType: "invoice",
      entityId: invoice.id,
      clientId: job.clientId,
      kind: "CREATED",
      summary: `Invoice ${number} drafted for ${job.number}: ${formatMoney(totals.totalCents)} incl GST${totals.creditCents ? `, ${formatMoney(totals.creditCents)} deposit credited` : ""}`,
    });
    return invoice;
  });
}

export const InvoiceLineSchema = z.object({
  description: z.string().trim().min(1, "Every line needs a description").max(300),
  quantity: z.number().positive("Quantity must be more than zero").max(10_000),
  unit: z.string().trim().min(1).max(20).default("each"),
  unitPriceCents: z.number().int().min(-100_000_00).max(100_000_00),
  source: z.string().default("MANUAL"),
});
export type InvoiceLineInput = z.input<typeof InvoiceLineSchema>;

/** Replaces the lines of a DRAFT invoice (the review step) and recomputes totals; the applied deposit stays. */
export async function replaceInvoiceLines(invoiceId: string, lines: InvoiceLineInput[], notes: string | undefined, actor: Actor) {
  const parsed = z.array(InvoiceLineSchema).min(1, "An invoice needs at least one line").max(60).parse(lines);
  return appDb.$transaction(async (tx) => {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (current.status !== "DRAFT") throw new InvoiceError("Only a draft invoice can be edited.");
    const totals = invoiceTotals(parsed.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents })), current.creditCents);
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    await tx.invoiceLine.createMany({
      data: parsed.map((l, i) => ({ invoiceId, position: i, source: l.source, description: l.description, quantity: l.quantity, unit: l.unit, unitPriceCents: l.unitPriceCents, lineTotalCents: lineTotalCents(l.quantity, l.unitPriceCents) })),
    });
    const invoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: { subtotalCents: totals.subtotalCents, gstCents: totals.gstCents, totalCents: totals.totalCents, creditCents: totals.creditCents, notes: notes?.trim() || null },
    });
    await recordActivity(tx, { actor, entityType: "invoice", entityId: invoiceId, clientId: invoice.clientId, kind: "UPDATED", summary: `Invoice ${invoice.number} updated: ${formatMoney(totals.totalCents)} incl GST` });
    return invoice;
  });
}

/** The reviewed invoice goes out: starts the 7-day terms, and the job becomes Invoiced (Paid if a deposit already covers it). */
export async function issueInvoice(invoiceId: string, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { _count: { select: { lines: true } } } });
    if (current.status !== "DRAFT") throw new InvoiceError("Only a draft invoice can be issued.");
    if (current._count.lines === 0 || current.totalCents <= 0) throw new InvoiceError("Add at least one priced line before issuing.");
    const now = new Date();
    const covered = balanceDueCents(current.totalCents, current.creditCents, 0) === 0;
    const invoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: covered ? "PAID" : "SENT", issuedAt: now, dueAt: addDays(now, PAYMENT_TERMS_DAYS), paidAt: covered ? now : null },
    });
    await setBillingStatus(tx, invoice.jobId, "INVOICED", actor);
    if (covered) await setBillingStatus(tx, invoice.jobId, "PAID", actor);
    await recordActivity(tx, {
      actor,
      entityType: "invoice",
      entityId: invoiceId,
      clientId: invoice.clientId,
      kind: "ISSUED",
      summary: `Invoice ${invoice.number} issued: ${formatMoney(invoice.totalCents)} incl GST, due ${invoice.dueAt!.toLocaleDateString("en-AU")}`,
    });
    return invoice;
  });
}

export const PaymentInputSchema = z.object({
  amountCents: z.number().int().positive("Enter the amount received"),
  method: z.enum(["CARD", "BANK", "CASH", "STRIPE"]),
  reference: z.preprocess(blank, z.string().trim().max(120).optional()),
  paidAt: z.date().optional(),
  stripePaymentId: z.preprocess(blank, z.string().max(120).optional()),
});
export type PaymentInput = z.input<typeof PaymentInputSchema>;

/** Records money received against an issued invoice. Part payments are fine; overpaying is not. */
export async function recordPayment(invoiceId: string, input: PaymentInput, actor: Actor) {
  const v = PaymentInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { select: { kind: true, amountCents: true } } } });
    if (current.status !== "SENT" && current.status !== "PARTIALLY_PAID") throw new InvoiceError(`A ${current.status.toLowerCase().replace("_", " ")} invoice cannot take a payment.`);
    const figures = withInvoiceFigures(current);
    if (v.amountCents > figures.balanceCents) throw new InvoiceError(`That is more than the ${formatMoney(figures.balanceCents)} still owing.`);
    await tx.payment.create({
      data: { kind: "INVOICE", invoiceId, jobId: current.jobId, method: v.method, amountCents: v.amountCents, paidAt: v.paidAt ?? new Date(), reference: v.reference ?? null, stripePaymentId: v.stripePaymentId ?? null, recordedByUserId: actorId(actor) },
    });
    const remaining = figures.balanceCents - v.amountCents;
    const paid = remaining === 0;
    const invoice = await tx.invoice.update({ where: { id: invoiceId }, data: { status: paid ? "PAID" : "PARTIALLY_PAID", paidAt: paid ? (v.paidAt ?? new Date()) : null } });
    if (paid) await setBillingStatus(tx, invoice.jobId, "PAID", actor);
    await recordActivity(tx, {
      actor,
      entityType: "invoice",
      entityId: invoiceId,
      clientId: invoice.clientId,
      kind: paid ? "PAID" : "PAYMENT",
      summary: paid ? `Invoice ${invoice.number} paid in full (${formatMoney(v.amountCents)} received)` : `Payment of ${formatMoney(v.amountCents)} received on ${invoice.number}; ${formatMoney(remaining)} still owing`,
    });
    return invoice;
  });
}

export const DepositInputSchema = z.object({
  amountCents: z.number().int().positive("Enter the amount received"),
  method: z.enum(["CARD", "BANK", "CASH", "STRIPE"]),
  reference: z.preprocess(blank, z.string().trim().max(120).optional()),
  stripePaymentId: z.preprocess(blank, z.string().max(120).optional()),
});

/** The deposit a quote asked for, received before the work: held against the job and credited at invoicing. */
export async function recordDeposit(jobId: string, input: z.input<typeof DepositInputSchema>, actor: Actor) {
  const v = DepositInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: { quote: { select: { depositRequired: true, depositCents: true } }, invoices: { where: { status: { not: "VOID" } }, select: { id: true } } } });
    if (job.invoices.length > 0) throw new InvoiceError("This job is already invoiced - record the payment on the invoice.");
    if (!job.quote?.depositRequired) throw new InvoiceError("This job's quote did not require a deposit.");
    const received = await tx.payment.aggregate({ where: { jobId, kind: "DEPOSIT" }, _sum: { amountCents: true } });
    const outstanding = job.quote.depositCents - (received._sum.amountCents ?? 0);
    if (v.amountCents > outstanding) throw new InvoiceError(`The deposit is ${formatMoney(job.quote.depositCents)}; only ${formatMoney(Math.max(0, outstanding))} is still due.`);
    const payment = await tx.payment.create({
      data: { kind: "DEPOSIT", jobId, method: v.method, amountCents: v.amountCents, reference: v.reference ?? null, stripePaymentId: v.stripePaymentId ?? null, recordedByUserId: actorId(actor) },
    });
    await recordActivity(tx, { actor, entityType: "job", entityId: jobId, clientId: job.clientId, kind: "DEPOSIT", summary: `${job.number}: deposit of ${formatMoney(v.amountCents)} received` });
    return payment;
  });
}

/** Deposit position of a job: what the quote asked for and what has arrived. */
export async function depositStatus(jobId: string) {
  const job = await appDb.job.findUnique({ where: { id: jobId }, select: { quote: { select: { depositRequired: true, depositCents: true } } } });
  if (!job?.quote?.depositRequired) return null;
  const received = await appDb.payment.aggregate({ where: { jobId, kind: "DEPOSIT" }, _sum: { amountCents: true } });
  const receivedCents = received._sum.amountCents ?? 0;
  return { requiredCents: job.quote.depositCents, receivedCents, outstandingCents: Math.max(0, job.quote.depositCents - receivedCents) };
}

/** Voids an invoice that has taken no money; its deposit credit is released back to the job and the job returns to Completed. */
export async function voidInvoice(invoiceId: string, reason: string, actor: Actor) {
  const why = z.string().trim().min(1, "Say why it is being voided").max(300).parse(reason);
  return appDb.$transaction(async (tx) => {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { where: { kind: "INVOICE" }, select: { id: true } } } });
    if (current.payments.length > 0) throw new InvoiceError("This invoice has payments on it and cannot be voided.");
    if (current.status !== "DRAFT" && current.status !== "SENT") throw new InvoiceError("Only a draft or an unpaid sent invoice can be voided.");
    const invoice = await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidReason: why } });
    await tx.payment.updateMany({ where: { invoiceId, kind: "DEPOSIT" }, data: { invoiceId: null } });
    if (current.status === "SENT") await setBillingStatus(tx, invoice.jobId, "COMPLETED", actor);
    await recordActivity(tx, { actor, entityType: "invoice", entityId: invoiceId, clientId: invoice.clientId, kind: "VOID", summary: `Invoice ${invoice.number} voided`, body: why });
    return invoice;
  });
}

export async function getInvoice(id: string) {
  const invoice = await appDb.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, payments: { orderBy: { paidAt: "asc" } }, client: true, job: { select: { id: true, number: true, title: true, site: true, quote: { select: { id: true, number: true } } } } },
  });
  return invoice ? withInvoiceFigures(invoice) : null;
}

export interface InvoiceListFilter {
  status?: EffectiveInvoiceStatus;
  clientId?: string;
  limit?: number;
}

export async function listInvoices(filter: InvoiceListFilter = {}) {
  const rows = await appDb.invoice.findMany({
    where: { ...(filter.clientId ? { clientId: filter.clientId } : {}) },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 300,
    include: { client: { select: { id: true, name: true } }, payments: { select: { kind: true, amountCents: true } }, job: { select: { number: true } } },
  });
  const withFigures = rows.map((r) => withInvoiceFigures(r));
  return filter.status ? withFigures.filter((i) => i.effectiveStatus === filter.status) : withFigures;
}

/** Money position for the dashboard: what is owed, what is overdue (with the chase stage), what came in this month. */
export async function receivablesSummary(now: Date = new Date()) {
  const issued = await appDb.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID"] } },
    include: { payments: { select: { kind: true, amountCents: true } }, client: { select: { id: true, name: true } } },
  });
  const figures = issued.map((i) => withInvoiceFigures(i, now));
  const overdue = figures.filter((i) => i.effectiveStatus === "OVERDUE").sort((a, b) => b.daysOverdue - a.daysOverdue);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const received = await appDb.payment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amountCents: true } });
  return {
    outstandingCents: figures.reduce((sum, i) => sum + i.balanceCents, 0),
    outstandingCount: figures.length,
    overdueCents: overdue.reduce((sum, i) => sum + i.balanceCents, 0),
    overdue: overdue.map((i) => ({ id: i.id, number: i.number, clientId: i.client.id, clientName: i.client.name, balanceCents: i.balanceCents, daysOverdue: i.daysOverdue, chase: i.chase })),
    receivedThisMonthCents: received._sum.amountCents ?? 0,
  };
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Invoices and payments as CSV, for the bookkeeper (accounting sync is out of scope for now). */
export async function invoicesCsv(): Promise<string> {
  const invoices = await listInvoices({ limit: 5000 });
  const header = ["Invoice", "Client", "Job", "Status", "Issued", "Due", "Subtotal", "GST", "Total", "Deposit credit", "Paid", "Balance"];
  const rows = invoices.map((i) => [i.number, i.client.name, i.job.number, i.effectiveStatus, i.issuedAt?.toISOString().slice(0, 10) ?? "", i.dueAt?.toISOString().slice(0, 10) ?? "", (i.subtotalCents / 100).toFixed(2), (i.gstCents / 100).toFixed(2), (i.totalCents / 100).toFixed(2), (i.creditCents / 100).toFixed(2), (i.paidCents / 100).toFixed(2), (i.balanceCents / 100).toFixed(2)]);
  const payments = await appDb.payment.findMany({ orderBy: { paidAt: "asc" }, include: { invoice: { select: { number: true } } } });
  const prows = payments.map((p) => [p.invoice?.number ?? "(deposit held)", p.kind, p.method, p.paidAt.toISOString().slice(0, 10), (p.amountCents / 100).toFixed(2), p.reference ?? ""]);
  return [header, ...rows, [], ["Payments"], ["Invoice", "Kind", "Method", "Date", "Amount", "Reference"], ...prows].map((r) => r.map((c) => csvCell(c as string)).join(",")).join("\n") + "\n";
}

export type { Prisma };

/** Saves the payment link a provider issued for this invoice (idempotent: the same link is kept). */
export async function setPaymentLink(invoiceId: string, link: { payUrl: string; providerRef: string }, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const invoice = await tx.invoice.update({ where: { id: invoiceId }, data: { payUrl: link.payUrl, stripeInvoiceId: link.providerRef } });
    await recordActivity(tx, { actor, entityType: "invoice", entityId: invoiceId, clientId: invoice.clientId, kind: "UPDATED", summary: `Payment link created for ${invoice.number}` });
    return invoice;
  });
}
