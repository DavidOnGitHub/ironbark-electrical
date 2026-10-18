/**
 * Deterministic stand-ins for the AI nodes, so a test run of the enquiry and review
 * workflows walks the whole path with believable answers and no LLM. They return the
 * same shapes as the real nodes' response schemas (see workflows/enquiryToReply.ts).
 */
const EMERGENCY = /\b(burning|burnt|smoke|sparks?|sparking|electric shock|shocked|smell of burning|fire)\b/i;
const URGENT = /\b(urgent|asap|today|no power|power is out|blackout|tripping)\b/i;
const NOT_ENQUIRY = /\b(unsubscribe|newsletter|webinar|invoice attached|remittance|receipt|marketing|seo)\b/i;
const INSTALL = /\b(install|new|downlights?|fan|charger|ev|solar|switchboard upgrade|extra (power )?points?|data point)\b/i;
const QUOTE = /\b(quote|quotation|how much|price|estimate)\b/i;
const FAULT = /\b(not working|dead|tripping|flicker|fault|repair|broken|no power|smell|buzz|hot)\b/i;
const NEGATIVE = /\b(not happy|unhappy|poor|terrible|disappointed|late|mess|complain|rude|rip.?off|never again|damaged|still (not|broken))\b/i;

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>/);
  const raw = (m?.[1] ?? from.split("@")[0] ?? "").trim();
  return raw.split(/[\s._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function triageEnquiry(p: Record<string, unknown>) {
  const from = String(p.from ?? "");
  const subject = String(p.subject ?? "");
  const body = String(p.body ?? "");
  const text = `${subject}\n${body}`;
  const name = senderName(from);
  const first = name.split(" ")[0] || "there";
  const isEnquiry = !NOT_ENQUIRY.test(text) && (QUOTE.test(text) || INSTALL.test(text) || FAULT.test(text) || EMERGENCY.test(text));
  const urgency = EMERGENCY.test(text) ? "EMERGENCY" : URGENT.test(text) ? "URGENT" : "ROUTINE";
  const category = FAULT.test(text) || EMERGENCY.test(text) ? "FAULT_REPAIR" : QUOTE.test(text) ? "QUOTE_REQUEST" : INSTALL.test(text) ? "NEW_INSTALL" : "OTHER";
  const phone = text.match(/(?:\+?61|0)[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3}|\(0\d\)\s?\d{4}\s?\d{4}/)?.[0] ?? "";
  const summary = (subject || body.split("\n")[0] || "Email enquiry").replace(/^(re|fwd?):\s*/i, "").slice(0, 120);
  return {
    isEnquiry,
    reason: isEnquiry ? "Describes electrical work or a fault." : "Does not look like a customer enquiry.",
    category,
    urgency,
    summary,
    contactName: name,
    contactPhone: phone,
    replyDraft: `Hi ${first},\n\n${urgency === "EMERGENCY" ? "What you describe could be unsafe - please turn off the power at the main switch if you can do so safely, keep clear of the area, and call us on (02) 5550 0142 right now. Someone is being alerted to ring you straight away.\n\n" : ""}Thanks for getting in touch. ${category === "QUOTE_REQUEST" || category === "NEW_INSTALL" ? "To give you an accurate quote, one of our electricians will come out for a free site visit of about an hour. Pick a time that suits you with the link below." : "We can send an electrician to look at this as soon as we can. Pick a time that suits you with the link below."}`,
  };
}

function classifyFeedback(p: Record<string, unknown>) {
  const body = String(p.body ?? "");
  const negative = NEGATIVE.test(body);
  return { sentiment: negative ? "negative" : "positive", isNegative: negative, summary: body.split("\n")[0]!.slice(0, 160) };
}

export function ironSparkMockAgent(operation: string, params: Record<string, unknown>): unknown {
  switch (operation) {
    case "triageEnquiry":
      return triageEnquiry(params);
    case "classifyFeedback":
      return classifyFeedback(params);
    default:
      throw new Error(`no mock agent fixture registered for "ironspark-agent.${operation}"`);
  }
}
