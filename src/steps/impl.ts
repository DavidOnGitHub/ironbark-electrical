/** The steps' implementations. They run in the worker, call the same module APIs the pages use, and
 * make no real change during a test run (reads still happen, so a test shows real matches). */
import type { WorkflowContext } from "@kabosh-digital/workflow-types";
import { appDb } from "../db/app";
import { recordActivity } from "../domain/activity";
import { findPossibleDuplicates } from "../domain/clients";
import { createRequest, type RequestInput } from "../domain/requests";
import { acceptUrlFor, ensureAcceptToken, getQuote } from "../domain/quotes";
import { getInvoice } from "../domain/invoicing";
import { ensurePaymentLink } from "../integrations/payments";
import { isAllowedRecipient } from "../integrations/allowlist";
import { renderTemplate } from "../domain/emailTemplates";
import { sendHtmlEmail } from "../integrations/gmailSend";
import { firstName, formalNotice, invoiceEmail, invoiceReminder, quoteEmail, quoteReminder, reviewRequest } from "./messages";
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
  // Whether the automation may write back to this sender (see integrations/allowlist.ts).
  const canEmail = isAllowedRecipient(sender.email);
  if (isTestRun(context)) return { requestId: "test-request", clientId, linked: !!clientId, isEmergency, canEmail, simulated: true };
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
  return { requestId: request.id, clientId, linked: !!clientId, isEmergency, canEmail, simulated: false };
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
  const allowed = email !== "" && isAllowedRecipient(email);
  const token = await ensureAcceptToken(quote.id);
  return {
    number: quote.number,
    title: quote.title,
    clientId: quote.clientId,
    clientName: quote.client.name,
    clientEmail: allowed ? email : "",
    hasEmail: allowed,
    // The address even when automatic mail to it is not allowed: a person can approve sending to it.
    emailAddress: email,
    hasEmailAddress: email !== "",
    status: quote.effectiveStatus,
    isOpen: quote.effectiveStatus === "SENT",
    totalText: formatMoney(quote.totalCents),
    emailSubject: first.subject,
    emailBody: first.body,
    reminderSubject: reminder.subject,
    reminderBody: reminder.body,
    clientFirstName: firstName(quote.client.name),
    // The customer's accept/decline page; empty until the quote is sent.
    acceptUrl: token ? acceptUrlFor(token) : "",
    validUntil: quote.validUntil.toLocaleDateString("en-AU"),
    depositNote: quote.depositCents > 0 ? `A deposit of ${formatMoney(quote.depositCents)} is needed to book the work in.` : "",
    lines: quote.lines.map((l) => `- ${l.description} (${Number(l.quantity)} ${l.unit}): ${formatMoney(l.lineTotalCents)}`).join("\n"),
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
  const allowed = email !== "" && isAllowedRecipient(email);
  return {
    number: invoice.number,
    clientId: invoice.clientId,
    clientName: invoice.client.name,
    clientEmail: allowed ? email : "",
    hasEmail: allowed,
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
    replyQuery: allowed ? `from:${email} newer_than:7d` : "",
    clientFirstName: firstName(invoice.client.name),
    jobTitle: invoice.job.title,
    dueDate: invoice.dueAt ? invoice.dueAt.toLocaleDateString("en-AU") : "the date on the invoice",
    dueNote: invoice.dueAt ? `Due by: ${invoice.dueAt.toLocaleDateString("en-AU")}` : "",
    payBlock: invoice.payUrl
      ? `[Pay securely by card](${invoice.payUrl})\n\nYou can also pay by bank transfer - reply to this email for our details.`
      : "To pay by bank transfer, reply to this email and we will send our details.",
    reviewUrl,
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

/** Renders an email template with the mapped variables and sends it (a test run renders - so a missing variable
 * shows up - but sends nothing). */
export async function sendTemplatedEmailImpl(config: Cfg & { template?: string; connectorId?: string }, context: WorkflowContext) {
  const p = asParams(config, context);
  const vars = Object.fromEntries(Object.entries((p.variables ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v == null ? undefined : str(v)]));
  const key = str(config.template);
  if (!key) throw new Error("sendTemplatedEmail: choose an email template.");
  const to = str(p.to);
  // A quote's accept link belongs in any quote email, even from a run that began before the workflow
  // mapped it (a run keeps the graph it started with, but the template is always the current one).
  const quoteId = (context.trigger as { quoteId?: unknown } | undefined)?.quoteId;
  if (vars.acceptUrl === undefined && typeof quoteId === "string") {
    const token = await ensureAcceptToken(quoteId);
    if (token) vars.acceptUrl = acceptUrlFor(token);
  }
  const mail = await renderTemplate(key, vars);
  if (isTestRun(context)) {
    console.log(`[sendTemplatedEmail:mock] template=${key} to=${to} subject="${mail.subject}"`);
    return { sent: true, to, subject: mail.subject };
  }
  if (!config.connectorId) throw new Error("sendTemplatedEmail: connect a Gmail account (Connected apps) and pick it in this step.");
  const id = await sendHtmlEmail(config.connectorId, { to, subject: mail.subject, text: mail.text, html: mail.html, replyToMessageId: str(p.inReplyTo) || undefined });
  console.log(`[sendTemplatedEmail] sent=${id} template=${key} to=${to} subject="${mail.subject}"`);
  return { sent: true, to, subject: mail.subject };
}

export const stepImpls: Record<string, (config: Cfg, context: WorkflowContext) => Promise<unknown>> = {
  findClient: findClientImpl,
  createEnquiry: createEnquiryImpl,
  getQuote: getQuoteImpl,
  getInvoice: getInvoiceImpl,
  createPaymentLink: createPaymentLinkImpl,
  addTimelineNote: addTimelineNoteImpl,
  sendTemplatedEmail: sendTemplatedEmailImpl,
};
