/** The steps' implementations. They run in the worker, call the same module APIs the pages use, and
 * make no real change during a test run (reads still happen, so a test shows real matches). */
import type { WorkflowContext } from "@kabosh-digital/workflow-types";
import { appDb } from "../db/app";
import { recordActivity } from "../domain/activity";
import { findPossibleDuplicates } from "../domain/clients";
import { createRequest, type RequestInput } from "../domain/requests";
import { getQuote } from "../domain/quotes";
import { getInvoice } from "../domain/invoicing";
import { ensurePaymentLink } from "../integrations/payments";
import { formalNotice, invoiceEmail, invoiceReminder, quoteEmail, quoteReminder, reviewRequest } from "./messages";
import { isTestRun, resolveParams, str } from "./runtime";
import { formatMoney } from "../lib/money";

type Cfg = { params?: Record<string, unknown> };
const asParams = (config: Cfg, context: WorkflowContext) => resolveParams(config.params, context);
const WORKFLOW = { type: "WORKFLOW" as const, label: "Automation" };

/** "Pat Smith <pat@example.com>" -> { name, email }. */
export function parseSender(from: string): { name: string; email: string } {
  const angle = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const email = (angle ? angle[2]! : from).trim().toLowerCase();
  return { name: angle && angle[1]!.trim() ? angle[1]!.trim() : "", email };
}

export async function findClientImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const [match] = await findPossibleDuplicates({ email: str(p.email) || null, phone: str(p.phone) || null });
  return { found: !!match, clientId: match?.client.id ?? null, name: match?.client.name ?? null };
}

const CATEGORIES = ["NEW_INSTALL", "FAULT_REPAIR", "QUOTE_REQUEST", "OTHER"];
const URGENCIES = ["ROUTINE", "URGENT", "EMERGENCY"];

export async function createEnquiryImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const sender = parseSender(str(p.from));
  const phone = str(p.contactPhone) || undefined;
  const matches = await findPossibleDuplicates({ email: sender.email || null, phone: phone ?? null });
  const clientId = matches.length === 1 ? matches[0]!.client.id : null;
  const category = CATEGORIES.includes(str(p.category)) ? str(p.category) : "OTHER";
  const urgency = URGENCIES.includes(str(p.urgency)) ? str(p.urgency) : "ROUTINE";
  const isEmergency = urgency === "EMERGENCY";
  if (isTestRun(context)) return { requestId: "test-request", clientId, linked: !!clientId, isEmergency, simulated: true };
  const request = await createRequest(
    {
      source: "EMAIL",
      category: category as RequestInput["category"],
      urgency: urgency as RequestInput["urgency"],
      summary: str(p.summary).slice(0, 200) || "Email enquiry",
      description: str(p.description) || undefined,
      clientId: clientId ?? undefined,
      contactName: str(p.contactName) || sender.name || undefined,
      contactEmail: sender.email || undefined,
      contactPhone: phone,
      rawEmailRef: str(p.messageId) || undefined,
    },
    { type: "WORKFLOW", label: "Enquiry to reply" },
  );
  return { requestId: request.id, clientId, linked: !!clientId, isEmergency, simulated: false };
}

export async function getQuoteImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const quote = await getQuote(str(p.quoteId));
  if (!quote) throw new Error(`Quote ${str(p.quoteId)} was not found.`);
  const mail = {
    clientName: quote.client.name,
    number: quote.number,
    title: quote.title,
    totalCents: quote.totalCents,
    depositCents: quote.depositCents,
    validUntil: quote.validUntil,
    lines: quote.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, lineTotalCents: l.lineTotalCents })),
  };
  const first = quoteEmail(mail);
  const reminder = quoteReminder(mail);
  const email = quote.client.email ?? "";
  return {
    number: quote.number,
    title: quote.title,
    clientId: quote.clientId,
    clientName: quote.client.name,
    clientEmail: email,
    hasEmail: email !== "",
    status: quote.effectiveStatus,
    isOpen: quote.effectiveStatus === "SENT",
    totalText: formatMoney(quote.totalCents),
    emailSubject: first.subject,
    emailBody: first.body,
    reminderSubject: reminder.subject,
    reminderBody: reminder.body,
  };
}

export async function getInvoiceImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const invoice = await getInvoice(str(p.invoiceId));
  if (!invoice) throw new Error(`Invoice ${str(p.invoiceId)} was not found.`);
  const mail = { clientName: invoice.client.name, number: invoice.number, title: invoice.job.title, balanceCents: invoice.balanceCents, totalCents: invoice.totalCents, dueAt: invoice.dueAt, payUrl: invoice.payUrl ?? "", daysOverdue: invoice.daysOverdue };
  const first = invoiceEmail(mail);
  const reminder = invoiceReminder(mail);
  const notice = formalNotice(mail);
  const reviewUrl = process.env.REVIEW_URL || "https://g.page/r/ironbark-electrical/review";
  const review = reviewRequest(invoice.client.name, invoice.job.title, reviewUrl);
  const reviewReminder = reviewRequest(invoice.client.name, invoice.job.title, reviewUrl, true);
  const email = invoice.client.email ?? "";
  return {
    number: invoice.number,
    clientId: invoice.clientId,
    clientName: invoice.client.name,
    clientEmail: email,
    hasEmail: email !== "",
    status: invoice.effectiveStatus,
    isPaid: invoice.status === "PAID",
    isOpen: (invoice.status === "SENT" || invoice.status === "PARTIALLY_PAID") && invoice.balanceCents > 0,
    balanceText: formatMoney(invoice.balanceCents),
    daysOverdue: invoice.daysOverdue,
    payUrl: invoice.payUrl ?? "",
    invoiceSubject: first.subject,
    invoiceBody: first.body,
    reminderSubject: reminder.subject,
    reminderBody: reminder.body,
    noticeSubject: notice.subject,
    noticeBody: notice.body,
    reviewSubject: review.subject,
    reviewBody: review.body,
    reviewReminderSubject: reviewReminder.subject,
    reviewReminderBody: reviewReminder.body,
    replyQuery: email ? `from:${email} newer_than:7d` : "",
  };
}

export async function createPaymentLinkImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const invoiceId = str(p.invoiceId);
  if (isTestRun(context)) {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} was not found.`);
    return { created: true, payUrl: `https://pay.example.test/${invoice.number}`, provider: "test" };
  }
  const { created, payUrl, provider } = await ensurePaymentLink(invoiceId, WORKFLOW);
  return { created, payUrl, provider };
}

export async function addTimelineNoteImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  const clientId = str(p.clientId);
  if (isTestRun(context) || !clientId) return { recorded: false };
  await recordActivity(appDb, { actor: { type: "WORKFLOW", label: str(p.workflow) || "Automation" }, entityType: "client", entityId: clientId, clientId, kind: "AUTOMATION", summary: str(p.summary).slice(0, 300) });
  return { recorded: true };
}

export const stepImpls: Record<string, (config: Cfg, context: WorkflowContext) => Promise<unknown>> = {
  findClient: findClientImpl,
  createEnquiry: createEnquiryImpl,
  getQuote: getQuoteImpl,
  getInvoice: getInvoiceImpl,
  createPaymentLink: createPaymentLinkImpl,
  addTimelineNote: addTimelineNoteImpl,
};
