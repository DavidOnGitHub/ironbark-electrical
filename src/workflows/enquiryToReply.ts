import { defineWorkflow, GMAIL_RETRY, LLM_RETRY, ref } from "./build";

export const ENQUIRY_ID = "def_ironspark_enquiry_to_reply";

const TRIAGE_SYSTEM_PROMPT = `You read the shared inbox of Ironbark Electrical, a small residential and light-commercial electrical contractor in Sydney.
Decide whether the email is a genuine enquiry from a customer who wants electrical work, a quote or a repair. Newsletters, sales pitches, invoices, receipts and spam are NOT enquiries.
Classify the enquiry (FAULT_REPAIR, NEW_INSTALL, QUOTE_REQUEST or OTHER) and its urgency: EMERGENCY only when there is a safety risk (burning smell, smoke, sparks, shocks, a hot switchboard); URGENT when they have no power or need help the same day; otherwise ROUTINE.
Extract the customer's name and phone number if present. Write: a one-line summary; a short acknowledgement email (ackBody) that says we have their message and will be in touch - for an EMERGENCY, tell them to switch off at the main switch if safe and to call (02) 5550 0142 now; and a proposed reply (replyDraft) that suggests a site visit or call-out time this week, in a warm, plain, Australian tone. Never promise a price.
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
    ackBody: { type: "string" },
    replyDraft: { type: "string" },
  },
  required: ["isEnquiry", "reason", "category", "urgency", "summary", "ackBody", "replyDraft"],
};

/** Enquiry to reply: an email arrives, the AI reads it, the enquiry is logged and acknowledged,
 * and a person approves the proposed reply before it is sent. Emergencies alert the owner first. */
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
        model: "claude-haiku-4-5",
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
    { id: "decision_can_email", type: "DECISION", label: "Send the automatic acknowledgement to this sender?" },
    { id: "log_not_emailed", type: "ACTION", stepKey: "logAudit", label: "No automatic email for this sender", config: { event: "sender_not_on_allowlist", params: { requestId: ref("log_enquiry.requestId") } } },
    {
      id: "acknowledge",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Acknowledge straight away",
      config: { template: "enquiry_ack", params: { to: ref("trigger.from"), inReplyTo: ref("trigger.message_id"), variables: { subject: ref("trigger.subject"), message: ref("triage.ackBody") } } },
      retryPolicy: GMAIL_RETRY,
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
      config: { taskType: "approve_reply", assigneeRole: "EDITOR", approval: true, reviewsNodeId: "send_reply", description: "Read the reply below. Approve to send it as written, or reject to reply by hand." },
    },
    { id: "decision_approved", type: "DECISION", label: "Approved?" },
    {
      id: "send_reply",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Send the approved reply",
      config: { template: "enquiry_reply", params: { to: ref("trigger.from"), inReplyTo: ref("trigger.message_id"), variables: { subject: ref("trigger.subject"), message: ref("triage.replyDraft") } }, terminal: true },
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
    { from: "log_enquiry", to: "decision_can_email" },
    { from: "decision_can_email", to: "acknowledge", when: { field: "log_enquiry.canEmail", op: "eq", value: true }, label: "Allowed" },
    { from: "decision_can_email", to: "log_not_emailed", label: "Not on the list" },
    { from: "log_not_emailed", to: "decision_emergency" },
    { from: "acknowledge", to: "decision_emergency" },
    { from: "decision_emergency", to: "emergency_task", when: { field: "log_enquiry.isEmergency", op: "eq", value: true }, label: "Safety risk" },
    { from: "decision_emergency", to: "approve_reply", label: "Routine or urgent" },
    { from: "emergency_task", to: "approve_reply" },
    { from: "approve_reply", to: "decision_approved" },
    { from: "decision_approved", to: "send_reply", when: { field: "approve_reply.approved", op: "eq", value: true }, label: "Approved" },
    { from: "decision_approved", to: "log_rejected", label: "Rejected" },
  ],
);
