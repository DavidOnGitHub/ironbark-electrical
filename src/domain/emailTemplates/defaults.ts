import type { Variables } from "./render";

/** The wording the automations start with. Created on first seed; after that the business owns and edits them
 * (a reset restores these). Keys are what the workflows' email steps refer to. */
export interface TemplateDefault {
  key: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  /** Sample values for the editor's preview. */
  sample: Variables;
}

const SIGN = "Kind regards,\nThe team at Ironbark Electrical";

export const DEFAULT_TEMPLATES: TemplateDefault[] = [
  {
    key: "enquiry_ack",
    name: "Enquiry - acknowledgement",
    description: "Sent at once when a new enquiry arrives. The AI writes the message; this adds the branding.",
    subject: "Re: {{subject}}",
    body: "{{message}}",
    sample: { subject: "Quote for 6 downlights", message: "Hi Pat,\n\nThanks for getting in touch about the downlights. We have your message and will be in touch shortly.\n\nKind regards,\nThe team at Ironbark Electrical" },
  },
  {
    key: "enquiry_reply",
    name: "Enquiry - approved reply",
    description: "The reply the office approves for a new enquiry. The AI drafts the message.",
    subject: "Re: {{subject}}",
    body: "{{message}}",
    sample: { subject: "Quote for 6 downlights", message: "Hi Pat,\n\nHappy to help. We can send an electrician to look at it on Thursday morning or Friday afternoon - which suits you?\n\nKind regards,\nThe team at Ironbark Electrical" },
  },
  {
    key: "quote_send",
    name: "Quote - sent to the customer",
    description: "Emailed when a quote is marked as sent.",
    subject: "Your quote {{number}} from Ironbark Electrical - {{title}}",
    body: `Hi {{clientFirstName}},\n\nThanks for choosing us to look at "{{title}}". Here is your quote {{number}}:\n\n{{lines}}\n\n**Total including GST: {{totalText}}**\n\n{{depositNote}}\n\nThis quote is valid until {{validUntil}}. To go ahead, just reply to this email and we will lock in a date.\n\n${SIGN}`,
    sample: { clientFirstName: "Pat", title: "Install 6 LED downlights", number: "Q-1042", lines: "- Electrician (3 hour): $330.00\n- LED downlight supply and fit (6 each): $540.00", totalText: "$957.00", depositNote: "", validUntil: "16/10/2026" },
  },
  {
    key: "quote_reminder",
    name: "Quote - friendly reminder",
    description: "Sent a day after the quote if the customer has not answered.",
    subject: "Following up on quote {{number}}",
    body: `Hi {{clientFirstName}},\n\nJust checking in on quote {{number}} for "{{title}}" ({{totalText}} including GST). It is valid until {{validUntil}}.\n\nIf you have any questions, or would like us to adjust anything, reply here or call us and we will sort it out. If you are ready to go ahead, reply "yes" and we will book you in.\n\n${SIGN}`,
    sample: { clientFirstName: "Pat", title: "Install 6 LED downlights", number: "Q-1042", totalText: "$957.00", validUntil: "16/10/2026" },
  },
  {
    key: "invoice_send",
    name: "Invoice - sent to the customer",
    description: "Emailed when an invoice is issued, with the card pay link.",
    subject: "Invoice {{number}} from Ironbark Electrical - {{balanceText}} due",
    body: `Hi {{clientFirstName}},\n\nThank you for having us out. Here is your invoice {{number}} for "{{title}}".\n\n**Amount due: {{balanceText}} including GST**\n{{dueNote}}\n\n{{payBlock}}\n\nThank you,\n${SIGN}`,
    sample: { clientFirstName: "Pat", title: "Install 6 LED downlights", number: "INV-3011", balanceText: "$957.00", dueNote: "Due by: 09/10/2026", payBlock: "[Pay securely by card](https://example.com/pay)\n\nYou can also pay by bank transfer - reply to this email for our details." },
  },
  {
    key: "invoice_reminder",
    name: "Invoice - friendly reminder",
    description: "Day 1 after the due date.",
    subject: "Friendly reminder: invoice {{number}}",
    body: `Hi {{clientFirstName}},\n\nA quick reminder that invoice {{number}} ({{balanceText}}) was due on {{dueDate}}. It may simply have crossed in the mail - if you have already paid, thank you, and please ignore this.\n\n{{payBlock}}\n\n${SIGN}`,
    sample: { clientFirstName: "Pat", number: "INV-3011", balanceText: "$957.00", dueDate: "09/10/2026", payBlock: "[Pay securely by card](https://example.com/pay)" },
  },
  {
    key: "invoice_notice",
    name: "Invoice - formal overdue notice",
    description: "Day 14 after the due date.",
    subject: "Overdue: invoice {{number}} - payment required",
    body: `Dear {{clientName}},\n\nOur records show invoice {{number}} for "{{title}}" is now {{daysOverdue}} days overdue, with {{balanceText}} outstanding.\n\nPlease arrange payment within 7 days of this notice, or contact us today if there is a problem we can help with.\n\n{{payBlock}}\n\n${SIGN}`,
    sample: { clientName: "Pat Smith", number: "INV-3011", title: "Install 6 LED downlights", daysOverdue: "14", balanceText: "$957.00", payBlock: "[Pay securely by card](https://example.com/pay)" },
  },
  {
    key: "review_request",
    name: "Review - request",
    description: "Sent a day after an invoice is paid.",
    subject: "How did we go?",
    body: `Hi {{clientFirstName}},\n\nWe hope you are happy with the work on "{{title}}". If you have a minute, a short review helps other locals find a reliable electrician:\n\n[Leave a review]({{reviewUrl}})\n\nIf anything was not right, reply to this email and the owner will personally make it right.\n\nThank you!\n${SIGN}`,
    sample: { clientFirstName: "Pat", title: "Install 6 LED downlights", reviewUrl: "https://example.com/review" },
  },
  {
    key: "review_reminder",
    name: "Review - gentle reminder",
    description: "One reminder, three days after the review request.",
    subject: "Would you mind sharing a quick review?",
    body: `Hi {{clientFirstName}},\n\nJust a gentle nudge - we hope you are happy with the work on "{{title}}". If you have a minute, a short review helps other locals find a reliable electrician:\n\n[Leave a review]({{reviewUrl}})\n\nIf anything was not right, reply to this email and the owner will personally make it right.\n\nThank you!\n${SIGN}`,
    sample: { clientFirstName: "Pat", title: "Install 6 LED downlights", reviewUrl: "https://example.com/review" },
  },
];
