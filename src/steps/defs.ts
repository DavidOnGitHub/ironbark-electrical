/**
 * Ironbark Electrical's workflow steps, as the visual builder sees them: label, description,
 * config and output shapes - nothing that touches the database. This module is
 * imported by the browser bundle (via StepCatalogSetup) and by the server; the
 * implementations are in impl.ts and run only in the worker.
 */
import { z } from "zod";
import { connectorRef, type StepCatalogEntry } from "@kabosh-digital/workflow-types";

const Params = <T extends z.ZodRawShape>(shape: T) => z.object({ params: z.object(shape) });

/** The browser builder swaps `template` for a dropdown of the business's current templates (see StepCatalogSetup);
 * the worker accepts any key and fails clearly when it does not exist. */
export function sendTemplatedEmailDef(templateKeys?: string[]): StepCatalogEntry {
  return {
    key: "sendTemplatedEmail",
    label: "Send templated email",
    kind: "ACTION",
    description: "Sends a branded email from one of the business's email templates (Setup > Email templates). Map each variable the template uses (\"Variable defaults\" fill in any that has no value, for example the draft when a person did not edit it); the email stops with a clear message if one has no value. \"Attach invoice id\" attaches that invoice as a PDF. Does nothing real in a test run.",
    configSchema: z.object({
      template: templateKeys && templateKeys.length > 0 ? z.enum(templateKeys as [string, ...string[]]) : z.string(),
      connectorId: connectorRef("EMAIL").optional(),
      params: z.object({ to: z.unknown(), inReplyTo: z.unknown().optional(), variables: z.record(z.unknown()).optional(), variableDefaults: z.record(z.unknown()).optional(), attachInvoiceId: z.unknown().optional() }),
    }),
    outputSchema: z.object({ sent: z.boolean(), to: z.string(), subject: z.string() }),
  };
}

export const findClientDef: StepCatalogEntry = {
  key: "findClient",
  label: "Find client",
  kind: "ACTION",
  description: "Looks for an existing client by email address or phone number.",
  configSchema: Params({ email: z.unknown().optional(), phone: z.unknown().optional() }),
  outputSchema: z.object({ found: z.boolean(), clientId: z.string().nullable(), name: z.string().nullable() }),
};

export const createEnquiryDef: StepCatalogEntry = {
  key: "createEnquiry",
  label: "Log an enquiry",
  kind: "ACTION",
  description: "Records an incoming enquiry in the pipeline and links it to the client when the email address or phone number matches one. Also gives the enquiry its \"pick a time\" link, for the reply. Does nothing in a test run.",
  configSchema: Params({
    from: z.unknown(),
    summary: z.unknown(),
    description: z.unknown().optional(),
    category: z.unknown().optional(),
    urgency: z.unknown().optional(),
    contactName: z.unknown().optional(),
    contactPhone: z.unknown().optional(),
    messageId: z.unknown().optional(),
  }),
  outputSchema: z.object({ requestId: z.string(), clientId: z.string().nullable(), linked: z.boolean(), isEmergency: z.boolean(), canEmail: z.boolean(), bookingUrl: z.string(), simulated: z.boolean() }),
};

export const getQuoteDef: StepCatalogEntry = {
  key: "getQuote",
  label: "Get quote details",
  kind: "ACTION",
  description: "Reads a quote: who it is for, its total, whether the customer has answered yet, and ready-to-send email wording. \"Has email\" is only true when the address is allowed to receive automatic mail; \"has email address\" says there is an address a person could approve sending to.",
  configSchema: Params({ quoteId: z.unknown() }),
  outputSchema: z.object({
    number: z.string(),
    title: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    clientEmail: z.string(),
    hasEmail: z.boolean(),
    emailAddress: z.string(),
    hasEmailAddress: z.boolean(),
    status: z.string(),
    isOpen: z.boolean(),
    totalText: z.string(),
    emailSubject: z.string(),
    emailBody: z.string(),
    reminderSubject: z.string(),
    reminderBody: z.string(),
    // For email templates (Setup > Email templates)
    clientFirstName: z.string(),
    validUntil: z.string(),
    depositNote: z.string(),
    lines: z.string(),
  }),
};

export const getInvoiceDef: StepCatalogEntry = {
  key: "getInvoice",
  label: "Get invoice details",
  kind: "ACTION",
  description: "Reads an invoice: who owes it, how much is still owing, whether it is paid, and ready-to-send wording for the invoice, reminder, formal notice and review request emails.",
  configSchema: Params({ invoiceId: z.unknown() }),
  outputSchema: z.object({
    number: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    clientEmail: z.string(),
    hasEmail: z.boolean(),
    status: z.string(),
    isPaid: z.boolean(),
    isOpen: z.boolean(),
    balanceText: z.string(),
    daysOverdue: z.number(),
    payUrl: z.string(),
    invoiceSubject: z.string(),
    invoiceBody: z.string(),
    reminderSubject: z.string(),
    reminderBody: z.string(),
    noticeSubject: z.string(),
    noticeBody: z.string(),
    reviewSubject: z.string(),
    reviewBody: z.string(),
    reviewReminderSubject: z.string(),
    reviewReminderBody: z.string(),
    replyQuery: z.string(),
    clientFirstName: z.string(),
    jobTitle: z.string(),
    dueDate: z.string(),
    dueNote: z.string(),
    payBlock: z.string(),
    reviewUrl: z.string(),
  }),
};

export const draftQuoteDef: StepCatalogEntry = {
  key: "draftQuote",
  label: "Draft a quote from a site visit",
  kind: "ACTION",
  description: "After an electrician's site visit, drafts a quote from the enquiry and the electrician's findings. It can only choose entries and quantities from the price list (it cannot invent a price), using AI when it is set up and keyword matching otherwise. The quote stays a draft for a person to check. Does nothing in a test run, and nothing if the enquiry already has a quote or is not linked to a client.",
  configSchema: Params({ visitId: z.unknown() }),
  outputSchema: z.object({ created: z.boolean(), quoteId: z.string(), number: z.string(), title: z.string(), lineCount: z.number(), totalText: z.string(), source: z.string(), reason: z.string(), simulated: z.boolean() }),
};

export const sendQuoteDef: StepCatalogEntry = {
  key: "sendQuote",
  label: "Send a draft quote",
  kind: "ACTION",
  description: "Marks a draft quote as sent and starts the quote follow-up (the customer is emailed the quote with its accept link, then reminded if they do not answer). Stops with a reason, instead of failing, when the quote cannot be sent yet (for example it has no priced lines). Does nothing in a test run.",
  configSchema: Params({ quoteId: z.unknown() }),
  outputSchema: z.object({ sent: z.boolean(), followUpStarted: z.boolean(), reason: z.string(), simulated: z.boolean() }),
};

export const draftInvoiceDef: StepCatalogEntry = {
  key: "draftInvoice",
  label: "Draft an invoice for a completed job",
  kind: "ACTION",
  description: "Drafts the invoice for a completed job from its quote, approved variations and any deposit already paid. The invoice stays a draft for a person to check. Stops with a reason, instead of failing, when the job is not completed, has no quote, or already has an invoice. Does nothing in a test run.",
  configSchema: Params({ jobId: z.unknown() }),
  outputSchema: z.object({ created: z.boolean(), invoiceId: z.string(), number: z.string(), totalText: z.string(), reason: z.string(), simulated: z.boolean() }),
};

export const sendInvoiceDef: StepCatalogEntry = {
  key: "sendInvoice",
  label: "Issue a draft invoice",
  kind: "ACTION",
  description: "Issues a draft invoice (the 7-day payment terms start) and starts the invoice follow-up: the customer is emailed the invoice as a PDF with bank transfer details, then chased if it is not paid. An invoice already covered by a deposit goes straight to the thank-you and review request. Stops with a reason, instead of failing, when the invoice cannot be issued. Does nothing in a test run.",
  configSchema: Params({ invoiceId: z.unknown() }),
  outputSchema: z.object({ sent: z.boolean(), followUpStarted: z.boolean(), reason: z.string(), simulated: z.boolean() }),
};

export const getJobBookingDef: StepCatalogEntry = {
  key: "getJobBooking",
  label: "Get a job's requested time",
  kind: "ACTION",
  description: "Reads a job whose customer has picked a day: who and where, the time they asked for and the technician it would be, and whether the customer may be emailed automatically.",
  configSchema: Params({ jobId: z.unknown() }),
  outputSchema: z.object({
    jobNumber: z.string(),
    title: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    clientFirstName: z.string(),
    emailAddress: z.string(),
    hasEmail: z.boolean(),
    hasHold: z.boolean(),
    requestedText: z.string(),
    technician: z.string(),
    addressText: z.string(),
    acceptUrl: z.string(),
    simulated: z.boolean(),
  }),
};

export const confirmJobBookingDef: StepCatalogEntry = {
  key: "confirmJobBooking",
  label: "Confirm the job's requested time",
  kind: "ACTION",
  description: "Schedules the job for the time its customer picked and the technician it was held for, so it appears in the technician's calendar. Stops with a reason, instead of failing, when the time is no longer held or the technician is no longer free. Does nothing in a test run.",
  configSchema: Params({ jobId: z.unknown() }),
  outputSchema: z.object({ confirmed: z.boolean(), reason: z.string(), whenText: z.string(), technician: z.string(), simulated: z.boolean() }),
};

export const releaseJobBookingDef: StepCatalogEntry = {
  key: "releaseJobBooking",
  label: "Release the job's requested time",
  kind: "ACTION",
  description: "Lets go of the time a customer picked, so it is free for others and the customer can choose again. Does nothing in a test run.",
  configSchema: Params({ jobId: z.unknown() }),
  outputSchema: z.object({ released: z.boolean(), simulated: z.boolean() }),
};

export const createPaymentLinkDef: StepCatalogEntry = {
  key: "createPaymentLink",
  label: "Create a payment link",
  kind: "ACTION",
  description: "Creates a card payment link for what is still owing on an invoice and saves it on the invoice. Does nothing in a test run, and nothing if no payment provider is set up.",
  configSchema: Params({ invoiceId: z.unknown() }),
  outputSchema: z.object({ created: z.boolean(), payUrl: z.string(), provider: z.string() }),
};

export const addTimelineNoteDef: StepCatalogEntry = {
  key: "addTimelineNote",
  label: "Add to the client's history",
  kind: "ACTION",
  description: "Records what the automation did on the client's history, so the team can see it. Does nothing in a test run.",
  configSchema: Params({ clientId: z.unknown(), summary: z.unknown(), workflow: z.unknown().optional() }),
  outputSchema: z.object({ recorded: z.boolean() }),
};

export const ironSparkStepDefs: StepCatalogEntry[] = [findClientDef, createEnquiryDef, getQuoteDef, getInvoiceDef, draftQuoteDef, sendQuoteDef, getJobBookingDef, confirmJobBookingDef, releaseJobBookingDef, draftInvoiceDef, sendInvoiceDef, createPaymentLinkDef, addTimelineNoteDef, sendTemplatedEmailDef()];

/** What the AI assistant is told about these steps, in the style of its built-in reference. */
export const ironSparkAssistantSteps = [
  { key: "findClient", reference: 'findClient: {"params":{"email":"<address>","phone":"<number>"}} - returns {found,clientId,name}.' },
  { key: "createEnquiry", reference: 'createEnquiry: {"params":{"from":"<sender>","summary":"<one line>","description":"...","category":"FAULT_REPAIR|NEW_INSTALL|QUOTE_REQUEST|OTHER","urgency":"ROUTINE|URGENT|EMERGENCY","contactName":"...","contactPhone":"...","messageId":"<gmail id>"}} - logs the enquiry and links the client; returns {requestId,clientId,linked,isEmergency,canEmail}; canEmail is false when the sender is not allowed to receive automatic mail.' },
  { key: "getQuote", reference: 'getQuote: {"params":{"quoteId":"<id>"}} - returns {clientName,clientEmail,hasEmail,emailAddress,hasEmailAddress,isOpen,totalText,emailSubject,emailBody,reminderSubject,reminderBody}; isOpen is false once the customer has answered.' },
  { key: "getInvoice", reference: 'getInvoice: {"params":{"invoiceId":"<id>"}} - returns {clientName,clientEmail,hasEmail,isPaid,isOpen,balanceText,daysOverdue,payUrl,invoiceSubject,invoiceBody,reminderSubject,reminderBody,noticeSubject,noticeBody,reviewSubject,reviewBody,reviewReminderSubject,reviewReminderBody,replyQuery}.' },
  { key: "draftQuote", reference: 'draftQuote: {"params":{"visitId":"<site visit id>"}} - drafts a quote from the visit\'s findings using only price-list entries; returns {created,quoteId,number,title,lineCount,totalText,source,reason}.' },
  { key: "sendQuote", reference: 'sendQuote: {"params":{"quoteId":"<id>"}} - sends a draft quote and starts the follow-up; returns {sent,followUpStarted,reason}.' },
  { key: "getJobBooking", reference: 'getJobBooking: {"params":{"jobId":"<id>"}} - returns {jobNumber,title,clientName,clientFirstName,emailAddress,hasEmail,hasHold,requestedText,technician,addressText,acceptUrl}.' },
  { key: "confirmJobBooking", reference: 'confirmJobBooking: {"params":{"jobId":"<id>"}} - schedules the job for the time its customer picked; returns {confirmed,reason,whenText,technician}.' },
  { key: "releaseJobBooking", reference: 'releaseJobBooking: {"params":{"jobId":"<id>"}} - frees the time the customer picked; returns {released}.' },
  { key: "draftInvoice", reference: 'draftInvoice: {"params":{"jobId":"<id>"}} - drafts the invoice for a completed job; returns {created,invoiceId,number,totalText,reason}.' },
  { key: "sendInvoice", reference: 'sendInvoice: {"params":{"invoiceId":"<id>"}} - issues a draft invoice and starts the invoice follow-up; returns {sent,followUpStarted,reason}.' },
  { key: "createPaymentLink", reference: 'createPaymentLink: {"params":{"invoiceId":"<id>"}} - returns {created,payUrl,provider}.' },
  { key: "sendTemplatedEmail", reference: 'sendTemplatedEmail: {"template":"<template key>","params":{"to":"<address>","inReplyTo":"<gmail id>","variables":{"<name>":"<value or $ref>"}}} - sends a branded email from an email template (Setup > Email templates); returns {sent,to,subject}.' },
  { key: "addTimelineNote", reference: 'addTimelineNote: {"params":{"clientId":"<id>","summary":"<what happened>","workflow":"<name>"}} - adds the line to the client\'s history.' },
];
