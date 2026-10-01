/**
 * Iron Spark's workflow steps, as the visual builder sees them: label, description,
 * config and output shapes - nothing that touches the database. This module is
 * imported by the browser bundle (via StepCatalogSetup) and by the server; the
 * implementations are in impl.ts and run only in the worker.
 */
import { z } from "zod";
import type { StepCatalogEntry } from "@kabosh-digital/workflow-types";

const Params = <T extends z.ZodRawShape>(shape: T) => z.object({ params: z.object(shape) });

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
  description: "Records an incoming enquiry in the pipeline and links it to the client when the email address or phone number matches one. Does nothing in a test run.",
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
  outputSchema: z.object({ requestId: z.string(), clientId: z.string().nullable(), linked: z.boolean(), isEmergency: z.boolean(), simulated: z.boolean() }),
};

export const getQuoteDef: StepCatalogEntry = {
  key: "getQuote",
  label: "Get quote details",
  kind: "ACTION",
  description: "Reads a quote: who it is for, its total, whether the customer has answered yet, and ready-to-send email wording.",
  configSchema: Params({ quoteId: z.unknown() }),
  outputSchema: z.object({
    number: z.string(),
    title: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    clientEmail: z.string(),
    hasEmail: z.boolean(),
    status: z.string(),
    isOpen: z.boolean(),
    totalText: z.string(),
    emailSubject: z.string(),
    emailBody: z.string(),
    reminderSubject: z.string(),
    reminderBody: z.string(),
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
  }),
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

export const ironSparkStepDefs: StepCatalogEntry[] = [findClientDef, createEnquiryDef, getQuoteDef, getInvoiceDef, createPaymentLinkDef, addTimelineNoteDef];

/** What the AI assistant is told about these steps, in the style of its built-in reference. */
export const ironSparkAssistantSteps = [
  { key: "findClient", reference: 'findClient: {"params":{"email":"<address>","phone":"<number>"}} - returns {found,clientId,name}.' },
  { key: "createEnquiry", reference: 'createEnquiry: {"params":{"from":"<sender>","summary":"<one line>","description":"...","category":"FAULT_REPAIR|NEW_INSTALL|QUOTE_REQUEST|OTHER","urgency":"ROUTINE|URGENT|EMERGENCY","contactName":"...","contactPhone":"...","messageId":"<gmail id>"}} - logs the enquiry and links the client; returns {requestId,clientId,linked,isEmergency}.' },
  { key: "getQuote", reference: 'getQuote: {"params":{"quoteId":"<id>"}} - returns {clientName,clientEmail,hasEmail,isOpen,totalText,emailSubject,emailBody,reminderSubject,reminderBody}; isOpen is false once the customer has answered.' },
  { key: "getInvoice", reference: 'getInvoice: {"params":{"invoiceId":"<id>"}} - returns {clientName,clientEmail,hasEmail,isPaid,isOpen,balanceText,daysOverdue,payUrl,invoiceSubject,invoiceBody,reminderSubject,reminderBody,noticeSubject,noticeBody,reviewSubject,reviewBody,reviewReminderSubject,reviewReminderBody,replyQuery}.' },
  { key: "createPaymentLink", reference: 'createPaymentLink: {"params":{"invoiceId":"<id>"}} - returns {created,payUrl,provider}.' },
  { key: "addTimelineNote", reference: 'addTimelineNote: {"params":{"clientId":"<id>","summary":"<what happened>","workflow":"<name>"}} - adds the line to the client\'s history.' },
];
