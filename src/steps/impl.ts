/** The steps' implementations. They run in the worker, call the same module APIs the pages use, and
 * make no real change during a test run (reads still happen, so a test shows real matches). */
import type { WorkflowContext } from "@kabosh-digital/workflow-types";
import { appDb } from "../db/app";
import { recordActivity } from "../domain/activity";
import { findPossibleDuplicates } from "../domain/clients";
import { createRequest, type RequestInput } from "../domain/requests";
import { acceptUrlFor, createQuote, ensureAcceptToken, getQuote, linesFromSuggestions, listQuotes, markQuoteSent, replaceQuoteLines, suggestLines } from "../domain/quotes";
import { bundleLines, listBundles, listPriceItems } from "../domain/pricing";
import { getSiteVisit } from "../domain/siteVisits";
import { activeHold, confirmJobHold, getJob, releaseJobHold, ScheduleConflictError } from "../domain/jobs";
import { formatSite } from "../domain/clients";
import { staffLabelMap } from "../domain/shared/staff";
import { formatDayTime, formatTime } from "../lib/tz";
import { afterInvoiceIssued, afterInvoicePaid, afterQuoteSent } from "../automation";
import { bookingUrlFor, bookingUrlForRequest } from "../domain/booking";
import { buildInvoicePdf, createInvoiceFromJob, getInvoice, InvoiceError, invoicePdfFilename, issueInvoice } from "../domain/invoicing";
import { bankTransferBlock } from "../lib/bank";
import { ensurePaymentLink } from "../integrations/payments";
import { isAllowedRecipient } from "../integrations/allowlist";
import { renderTemplate } from "../domain/emailTemplates";
import { sendHtmlEmail } from "../integrations/gmailSend";
import { firstName, formalNotice, invoiceEmail, invoiceReminder, quoteEmail, quoteReminder, reviewRequest } from "./messages";
import { emailVariables, isTestRun, resolveParams, str } from "./runtime";
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
  if (isTestRun(context)) return { requestId: "test-request", clientId, linked: !!clientId, isEmergency, canEmail, bookingUrl: bookingUrlFor("test-booking-link"), simulated: true };
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
  return { requestId: request.id, clientId, linked: !!clientId, isEmergency, canEmail, bookingUrl: await bookingUrlForRequest(request.id), simulated: false };
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
    payBlock: invoice.payUrl ? `[Pay securely by card](${invoice.payUrl})\n\n${bankTransferBlock(invoice.number)}` : bankTransferBlock(invoice.number),
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
  const vars = emailVariables(p);
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
  // Likewise the "pick a time" link of an enquiry reply, for a run that began before the workflow mapped it.
  const enquiry = (context as Record<string, unknown>).log_enquiry as { requestId?: unknown; bookingUrl?: unknown } | undefined;
  if (vars.bookingUrl === undefined && typeof enquiry?.requestId === "string" && !isTestRun(context)) {
    vars.bookingUrl = typeof enquiry.bookingUrl === "string" && enquiry.bookingUrl ? enquiry.bookingUrl : await bookingUrlForRequest(enquiry.requestId);
  }
  const mail = await renderTemplate(key, vars);
  const attachInvoiceId = str(p.attachInvoiceId);
  if (isTestRun(context)) {
    console.log(`[sendTemplatedEmail:mock] template=${key} to=${to} subject="${mail.subject}"${attachInvoiceId ? " (+ invoice PDF)" : ""}`);
    return { sent: true, to, subject: mail.subject };
  }
  if (!config.connectorId) throw new Error("sendTemplatedEmail: connect a Gmail account (Connected apps) and pick it in this step.");
  const attachments = [];
  if (attachInvoiceId) {
    const invoice = await getInvoice(attachInvoiceId);
    if (!invoice) throw new Error(`sendTemplatedEmail: invoice ${attachInvoiceId} was not found, so it could not be attached.`);
    attachments.push({ filename: invoicePdfFilename(invoice.number), mimeType: "application/pdf", data: await buildInvoicePdf(invoice) });
  }
  const id = await sendHtmlEmail(config.connectorId, { to, subject: mail.subject, text: mail.text, html: mail.html, replyToMessageId: str(p.inReplyTo) || undefined, attachments });
  console.log(`[sendTemplatedEmail] sent=${id} template=${key} to=${to} subject="${mail.subject}"`);
  return { sent: true, to, subject: mail.subject };
}

const NO_QUOTE = { quoteId: "", number: "", title: "", lineCount: 0, totalText: "", source: "" };

/** Drafts a quote from a finished site visit: the enquiry's wording plus what the electrician found, matched to the price list. */
export async function draftQuoteImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { created: true, quoteId: "test-quote", number: "Q-TEST", title: "Test quote", lineCount: 0, totalText: formatMoney(0), source: "test", reason: "", simulated: true };
  const visit = await getSiteVisit(str(p.visitId));
  if (!visit) throw new Error(`Site visit ${str(p.visitId)} was not found.`);
  const request = visit.request;
  if (!request.clientId) return { created: false, ...NO_QUOTE, reason: "The enquiry is not linked to a client yet, so a quote cannot be drafted.", simulated: false };
  if ((await listQuotes({ requestId: request.id })).length > 0) return { created: false, ...NO_QUOTE, reason: "This enquiry already has a quote.", simulated: false };

  const [items, bundles] = await Promise.all([listPriceItems({ activeOnly: true }), listBundles({ activeOnly: true })]);
  const findings = visit.findings?.trim() ?? "";
  const wording = [request.summary, request.description, findings && `Site inspection: ${findings}`].filter(Boolean).join("\n\n");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const result = await suggestLines(
    wording,
    items.map((i) => ({ id: i.id, name: i.name, description: i.description, kind: i.kind, unit: i.unit, priceCents: i.priceCents })),
    bundles.map((b) => ({ id: b.id, name: b.name, description: b.description, lines: bundleLines(b) })),
    apiKey ? { apiKey } : undefined,
  );
  const lines = linesFromSuggestions(result.suggestions);
  const actor = { type: "WORKFLOW" as const, label: "Site visit to quote" };
  const quote = await createQuote({ clientId: request.clientId, siteId: request.siteId ?? undefined, requestId: request.id, title: request.summary.slice(0, 200), notes: findings ? `Based on our site inspection: ${findings}`.slice(0, 1900) : undefined }, actor);
  if (lines.length > 0) await replaceQuoteLines(quote.id, lines.map((l) => ({ priceItemId: l.priceItemId, description: l.description, quantity: l.quantity, unit: l.unit, unitPriceCents: l.unitPriceCents })), actor);
  const saved = (await getQuote(quote.id))!;
  return {
    created: true,
    quoteId: quote.id,
    number: quote.number,
    title: quote.title,
    lineCount: lines.length,
    totalText: formatMoney(saved.totalCents),
    source: result.source,
    reason: lines.length > 0 ? "" : "Nothing in the price list matched, so the quote has no lines yet. Add them before sending.",
    simulated: false,
  };
}

/** Sends a draft quote once a person has approved it, and starts the follow-up that emails it. */
export async function sendQuoteImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { sent: true, followUpStarted: false, reason: "", simulated: true };
  const quoteId = str(p.quoteId);
  const quote = await getQuote(quoteId);
  if (!quote) return { sent: false, followUpStarted: false, reason: "The quote no longer exists.", simulated: false };
  if (quote.status !== "DRAFT") return { sent: false, followUpStarted: false, reason: "The quote has already been sent or answered.", simulated: false };
  try {
    await markQuoteSent(quoteId, { type: "WORKFLOW", label: "Site visit to quote" });
  } catch (err) {
    return { sent: false, followUpStarted: false, reason: err instanceof Error ? err.message : "The quote could not be sent.", simulated: false };
  }
  const started = await afterQuoteSent(quoteId);
  return { sent: true, followUpStarted: started.started, reason: started.started ? "" : "The quote follow-up is not running, so nothing was emailed. Send it to the customer yourself.", simulated: false };
}

const bookingActor = { type: "WORKFLOW" as const, label: "Job booking" };
const whenText = (start: Date, end: Date) => `${formatDayTime(start)} - ${formatTime(end)}`;

/** A job whose customer has picked a day: everything the approval and the emails need. */
export async function getJobBookingImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) {
    return { jobNumber: "J-TEST", title: "Test job", clientId: "test-client", clientName: "Test Customer", clientFirstName: "Test", emailAddress: "", hasEmail: false, hasHold: true, requestedText: "Tue 21 Oct, 8:00 am - 12:00 pm", technician: "Test Technician", addressText: "1 Test St, Newtown NSW 2042", acceptUrl: "", simulated: true };
  }
  const job = await getJob(str(p.jobId));
  if (!job) throw new Error(`Job ${str(p.jobId)} was not found.`);
  const hold = activeHold(job);
  const labels = await staffLabelMap();
  const email = job.client.email ?? "";
  const token = job.quote ? await ensureAcceptToken(job.quote.id) : null;
  return {
    jobNumber: job.number,
    title: job.title,
    clientId: job.clientId,
    clientName: job.client.name,
    clientFirstName: firstName(job.client.name),
    emailAddress: email,
    hasEmail: email !== "" && isAllowedRecipient(email),
    hasHold: !!hold,
    requestedText: hold ? whenText(hold.start, hold.end) : "",
    technician: hold ? (labels.get(hold.userId) ?? "") : "",
    addressText: job.site ? formatSite(job.site) : "",
    acceptUrl: token ? acceptUrlFor(token) : "",
    simulated: false,
  };
}

/** Approves the held time: the job is scheduled and appears in the technician's calendar. */
export async function confirmJobBookingImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { confirmed: true, reason: "", whenText: "", technician: "", simulated: true };
  const jobId = str(p.jobId);
  const job = await getJob(jobId);
  const hold = job ? activeHold(job) : null;
  const tech = hold ? ((await staffLabelMap()).get(hold.userId) ?? "the technician") : "";
  try {
    const saved = await confirmJobHold(jobId, bookingActor, tech);
    return { confirmed: true, reason: "", whenText: saved.scheduledStart && saved.scheduledEnd ? whenText(saved.scheduledStart, saved.scheduledEnd) : "", technician: tech, simulated: false };
  } catch (err) {
    return { confirmed: false, reason: err instanceof ScheduleConflictError || err instanceof Error ? err.message : "The job could not be scheduled.", whenText: "", technician: tech, simulated: false };
  }
}

/** Frees the time the customer picked. */
export async function releaseJobBookingImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { released: true, simulated: true };
  await releaseJobHold(str(p.jobId), bookingActor);
  return { released: true, simulated: false };
}

const invoicingActor = { type: "WORKFLOW" as const, label: "Job to invoice" };

/** Drafts the invoice for a completed job; the office checks it before it goes out. */
export async function draftInvoiceImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { created: true, invoiceId: "test-invoice", number: "INV-TEST", totalText: formatMoney(0), reason: "", simulated: true };
  try {
    const invoice = await createInvoiceFromJob(str(p.jobId), invoicingActor);
    return { created: true, invoiceId: invoice.id, number: invoice.number, totalText: formatMoney(invoice.totalCents), reason: "", simulated: false };
  } catch (err) {
    if (err instanceof InvoiceError) return { created: false, invoiceId: "", number: "", totalText: "", reason: err.message, simulated: false };
    throw err;
  }
}

/** Issues an approved draft invoice and starts the follow-up that emails it (with its PDF) and chases payment. */
export async function sendInvoiceImpl(config: Cfg, context: WorkflowContext) {
  const p = asParams(config, context);
  if (isTestRun(context)) return { sent: true, followUpStarted: false, reason: "", simulated: true };
  const invoiceId = str(p.invoiceId);
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { sent: false, followUpStarted: false, reason: "The invoice no longer exists.", simulated: false };
  if (invoice.status !== "DRAFT") return { sent: false, followUpStarted: false, reason: "The invoice has already been issued.", simulated: false };
  let issued;
  try {
    issued = await issueInvoice(invoiceId, invoicingActor);
  } catch (err) {
    if (err instanceof InvoiceError) return { sent: false, followUpStarted: false, reason: err.message, simulated: false };
    throw err;
  }
  // An invoice already covered by a deposit is paid at once: skip chasing, go straight to the thank-you.
  const started = issued.status === "PAID" ? await afterInvoicePaid(invoiceId) : await afterInvoiceIssued(invoiceId);
  return { sent: true, followUpStarted: started.started, reason: started.started ? "" : "The invoice follow-up is not running, so nothing was emailed. Send it to the customer yourself.", simulated: false };
}

export const stepImpls: Record<string, (config: Cfg, context: WorkflowContext) => Promise<unknown>> = {
  findClient: findClientImpl,
  createEnquiry: createEnquiryImpl,
  getQuote: getQuoteImpl,
  getInvoice: getInvoiceImpl,
  draftQuote: draftQuoteImpl,
  sendQuote: sendQuoteImpl,
  getJobBooking: getJobBookingImpl,
  draftInvoice: draftInvoiceImpl,
  sendInvoice: sendInvoiceImpl,
  confirmJobBooking: confirmJobBookingImpl,
  releaseJobBooking: releaseJobBookingImpl,
  createPaymentLink: createPaymentLinkImpl,
  addTimelineNote: addTimelineNoteImpl,
  sendTemplatedEmail: sendTemplatedEmailImpl,
};
