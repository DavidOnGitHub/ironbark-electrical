import { defineWorkflow, GMAIL_RETRY, LLM_RETRY, ref } from "./build";

export const ENQUIRY_ID = "def_ironspark_enquiry_to_reply";

const TRIAGE_SYSTEM_PROMPT = `You read the shared inbox of Ironbark Electrical, a small residential and light-commercial electrical contractor in Sydney.
Decide whether the email is a genuine enquiry from a customer who wants electrical work, a quote or a repair. Newsletters, sales pitches, invoices, receipts and spam are NOT enquiries.
Classify the enquiry (FAULT_REPAIR, NEW_INSTALL, QUOTE_REQUEST or OTHER) and its urgency: EMERGENCY only when there is a safety risk (burning smell, smoke, sparks, shocks, a hot switchboard); URGENT when they have no power or need help the same day; otherwise ROUTINE.
Extract the customer's name and phone number if present. Write: a one-line summary; and a proposed reply (replyDraft) that thanks them once, confirms we have received their email, and - for a quote request or new install - explains that to quote accurately one of our electricians will come out for a free site visit of about an hour, and that they can pick a time that suits them using the link below the message. For a fault or repair, say we will get an electrician out as soon as we can and that they can pick a time with the link. Write in a warm, plain, Australian tone. Do not write the link or a sign-off yourself - both are added automatically below your message - and do not propose specific dates or times. Nobody else emails the customer first, so the reply must stand on its own. For an EMERGENCY, begin the reply by telling them to switch off at the main switch if it is safe to do so, keep clear, and call (02) 5550 0142 now. Never promise a price.
Always answer by calling submit_result.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    isEnquiry: { type: "boolean" },
    reason: { type: "string", description: "One sentence: why this is or is not an enquiry." },
    category: { type: "string", enum: ["FAULT_REPAIR", "NEW_INSTALL", "QUOTE_REQUEST", "OTHER"] },
    urgency: { type: "string", enum: ["ROUTINE", "URGENT", "EMERGENCY"] },
    summary: { type: "string", description: "One line for the pipeline." },
    contactName: { type: "string" },
    contactPhone: { type: "string", description: "Empty if not given." },
    replyDraft: { type: "string" },
  },
  required: ["isEnquiry", "reason", "category", "urgency", "summary", "replyDraft"],
};

/** Enquiry to reply: an email arrives, the AI reads it, the enquiry is logged,
 * and a person approves the proposed reply before it is sent (the customer gets one email, not an acknowledgement and a reply). Emergencies alert the owner first. */
export const enquiryToReply = defineWorkflow(
  { id: ENQUIRY_ID, name: "Enquiry to reply" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "emailInbound", label: "New email in the shared inbox", config: { connectorId: "", query: "in:inbox -from:me -category:promotions -category:social" } },
    {
      id: "triage",
      type: "ACTION",
      stepKey: "aiAgent",
      label: "Read and sort the enquiry",
      config: {
        service: "ironspark-agent",
        operation: "triageEnquiry",
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        promptTemplate: "From: {{from}}\nSubject: {{subject}}\n\n{{body}}",
        params: { from: ref("trigger.from"), subject: ref("trigger.subject"), body: ref("trigger.body") },
        responseSchema: RESPONSE_SCHEMA,
        maxToolCalls: 1,
      },
      retryPolicy: LLM_RETRY,
    },
    { id: "decision_enquiry", type: "DECISION", label: "A real enquiry?" },
    {
      id: "log_enquiry",
      type: "ACTION",
      stepKey: "createEnquiry",
      label: "Log it in the pipeline",
      config: {
        params: {
          from: ref("trigger.from"),
          summary: ref("triage.summary"),
          description: ref("trigger.body"),
          category: ref("triage.category"),
          urgency: ref("triage.urgency"),
          contactName: ref("triage.contactName"),
          contactPhone: ref("triage.contactPhone"),
          messageId: ref("trigger.message_id"),
        },
      },
    },
    { id: "decision_emergency", type: "DECISION", label: "An emergency?" },
    {
      id: "emergency_task",
      type: "HUMAN_TASK",
      label: "Owner phones the customer now",
      config: { taskType: "call_back_emergency", assigneeRole: "ADMIN", description: "The enquiry describes a possible safety risk. Phone the customer straight away (number in the enquiry), then mark this done." },
    },
    {
      id: "approve_reply",
      type: "HUMAN_TASK",
      label: "Office approves the reply",
      config: { taskType: "approve_reply", assigneeRole: "EDITOR", approval: true, reviewsNodeId: "send_reply", editsVariable: "message", editHint: "The \"Choose a time\" link and the sign-off are added automatically below your message.", description: "Read the email below. Edit the message if you want to change it, then approve to send, or reject to reply by hand." },
    },
    { id: "decision_approved", type: "DECISION", label: "Approved?" },
    {
      id: "send_reply",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Send the approved reply",
      config: { template: "enquiry_reply", params: { to: ref("trigger.from"), inReplyTo: ref("trigger.message_id"), variables: { subject: ref("trigger.subject"), message: ref("approve_reply.message"), bookingUrl: ref("log_enquiry.bookingUrl") }, variableDefaults: { message: ref("triage.replyDraft") } }, terminal: true },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "log_rejected", type: "ACTION", stepKey: "logAudit", label: "Reply by hand", config: { event: "reply_rejected", params: { requestId: ref("log_enquiry.requestId") }, terminal: true } },
    { id: "log_ignored", type: "ACTION", stepKey: "logAudit", label: "Leave it for a person", config: { event: "not_an_enquiry", params: { from: ref("trigger.from"), reason: ref("triage.reason") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "triage" },
    { from: "triage", to: "decision_enquiry" },
    { from: "decision_enquiry", to: "log_enquiry", when: { field: "triage.isEnquiry", op: "eq", value: true }, label: "An enquiry" },
    { from: "decision_enquiry", to: "log_ignored", label: "Not an enquiry" },
    { from: "log_enquiry", to: "decision_emergency" },
    { from: "decision_emergency", to: "emergency_task", when: { field: "log_enquiry.isEmergency", op: "eq", value: true }, label: "Safety risk" },
    { from: "decision_emergency", to: "approve_reply", label: "Routine or urgent" },
    { from: "emergency_task", to: "approve_reply" },
    { from: "approve_reply", to: "decision_approved" },
    { from: "decision_approved", to: "send_reply", when: { field: "approve_reply.approved", op: "eq", value: true }, label: "Approved" },
    { from: "decision_approved", to: "log_rejected", label: "Rejected" },
  ],
);
