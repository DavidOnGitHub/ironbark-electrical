/**
 * The wording of the emails the automations send (pure, so it is unit-tested and
 * easy to change). Plain, courteous, Australian; every message names the business,
 * the document and the amount, and says what to do next.
 */
import { formatMoney } from "../lib/money";

const SIGNOFF = "Kind regards,\nThe team at Ironbark Electrical\n(02) 5550 0142";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export interface QuoteMailInput {
  clientName: string;
  number: string;
  title: string;
  totalCents: number;
  depositCents: number;
  validUntil: Date;
  lines: { description: string; quantity: number; unit: string; lineTotalCents: number }[];
}

export function quoteEmail(q: QuoteMailInput) {
  const lines = q.lines.map((l) => `  - ${l.description} (${l.quantity} ${l.unit}): ${formatMoney(l.lineTotalCents)}`).join("\n");
  const deposit = q.depositCents > 0 ? `\nA deposit of ${formatMoney(q.depositCents)} is needed to book the work in.\n` : "";
  return {
    subject: `Your quote ${q.number} from Ironbark Electrical - ${q.title}`,
    body: `Hi ${firstName(q.clientName)},\n\nThanks for choosing us to look at "${q.title}". Here is your quote ${q.number}:\n\n${lines}\n\nTotal including GST: ${formatMoney(q.totalCents)}${deposit}\nThis quote is valid until ${q.validUntil.toLocaleDateString("en-AU")}. To go ahead, just reply to this email and we will lock in a date.\n\n${SIGNOFF}`,
  };
}

export function quoteReminder(q: QuoteMailInput) {
  return {
    subject: `Following up on quote ${q.number}`,
    body: `Hi ${firstName(q.clientName)},\n\nJust checking in on quote ${q.number} for "${q.title}" (${formatMoney(q.totalCents)} including GST). It is valid until ${q.validUntil.toLocaleDateString("en-AU")}.\n\nIf you have any questions, or would like us to adjust anything, reply here or call us and we will sort it out. If you are ready to go ahead, reply "yes" and we will book you in.\n\n${SIGNOFF}`,
  };
}

export interface InvoiceMailInput {
  clientName: string;
  number: string;
  title: string;
  balanceCents: number;
  totalCents: number;
  dueAt: Date | null;
  payUrl: string;
  daysOverdue: number;
}

const payLine = (payUrl: string) => (payUrl ? `\nPay securely by card here: ${payUrl}\nYou can also pay by bank transfer - reply to this email for our details.\n` : "\nTo pay by bank transfer, reply to this email and we will send our details.\n");

export function invoiceEmail(i: InvoiceMailInput) {
  return {
    subject: `Invoice ${i.number} from Ironbark Electrical - ${formatMoney(i.balanceCents)} due`,
    body: `Hi ${firstName(i.clientName)},\n\nThank you for having us out. Here is your invoice ${i.number} for "${i.title}".\n\nAmount due: ${formatMoney(i.balanceCents)} including GST${i.dueAt ? `\nDue by: ${i.dueAt.toLocaleDateString("en-AU")}` : ""}\n${payLine(i.payUrl)}\nThank you,\n${SIGNOFF}`,
  };
}

export function invoiceReminder(i: InvoiceMailInput) {
  return {
    subject: `Friendly reminder: invoice ${i.number}`,
    body: `Hi ${firstName(i.clientName)},\n\nA quick reminder that invoice ${i.number} (${formatMoney(i.balanceCents)}) was due on ${i.dueAt?.toLocaleDateString("en-AU") ?? "the date on the invoice"}. It may simply have crossed in the mail - if you have already paid, thank you, and please ignore this.\n${payLine(i.payUrl)}\n${SIGNOFF}`,
  };
}

export function formalNotice(i: InvoiceMailInput) {
  return {
    subject: `Overdue: invoice ${i.number} - payment required`,
    body: `Dear ${i.clientName},\n\nOur records show invoice ${i.number} for "${i.title}" is now ${i.daysOverdue} days overdue, with ${formatMoney(i.balanceCents)} outstanding.\n\nPlease arrange payment within 7 days of this notice, or contact us today if there is a problem we can help with.\n${payLine(i.payUrl)}\n${SIGNOFF}`,
  };
}

export function reviewRequest(clientName: string, title: string, reviewUrl: string, reminder = false) {
  return {
    subject: reminder ? "Would you mind sharing a quick review?" : "How did we go?",
    body: `Hi ${firstName(clientName)},\n\n${reminder ? "Just a gentle nudge - " : ""}we hope you are happy with the work on "${title}". If you have a minute, a short review helps other locals find a reliable electrician:\n\n${reviewUrl}\n\nIf anything was not right, reply to this email and the owner will personally make it right.\n\nThank you!\n${SIGNOFF}`,
  };
}
