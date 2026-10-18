import { DAYS, defineWorkflow, GMAIL_RETRY, LLM_RETRY, ref } from "./build";

export const REVIEW_ID = "def_ironspark_review_request";

const FEEDBACK_PROMPT = `You read a customer's reply to a request for a review of an electrician's work. Decide whether the reply is negative: a complaint, disappointment, a problem with the work, price, tidiness or timing. Thanks and praise are positive. Always answer by calling submit_result.`;

/** Review request: started when an invoice is paid. It thanks the customer and asks for a review straight away, three days later
 * it nudges once if there is no reply, and an unhappy reply goes straight to the owner. */
export const reviewRequest = defineWorkflow(
  { id: REVIEW_ID, name: "Review request" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "An invoice was paid", config: { fields: [{ name: "invoiceId", description: "The invoice's id", example: "", required: true }] } },
    { id: "load_invoice", type: "ACTION", stepKey: "getInvoice", label: "Read the invoice", config: { params: { invoiceId: ref("trigger.invoiceId") } } },
    { id: "decision_email", type: "DECISION", label: "Do we have their email?" },
    {
      id: "send_review",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Thank them and ask for a review",
      config: { template: "review_request", params: { to: ref("load_invoice.clientEmail"), variables: { clientFirstName: ref("load_invoice.clientFirstName"), title: ref("load_invoice.jobTitle"), reviewUrl: ref("load_invoice.reviewUrl") } } },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "wait_2", type: "DELAY", label: "Wait three days", config: { seconds: 3 * DAYS } },
    { id: "check_replies", type: "ACTION", stepKey: "emailRead", label: "Did they reply?", config: { params: { query: ref("load_invoice.replyQuery"), readState: "all", limit: 1 } }, retryPolicy: GMAIL_RETRY },
    { id: "decision_replied", type: "DECISION", label: "A reply?" },
    {
      id: "classify",
      type: "ACTION",
      stepKey: "aiAgent",
      label: "Is the reply unhappy?",
      config: {
        service: "ironspark-agent",
        operation: "classifyFeedback",
        model: "claude-haiku-4-5",
        systemPrompt: FEEDBACK_PROMPT,
        promptTemplate: "{{body}}",
        params: { body: ref("check_replies.messages.0.body") },
        responseSchema: { type: "object", properties: { sentiment: { type: "string", enum: ["positive", "negative"] }, isNegative: { type: "boolean" }, summary: { type: "string" } }, required: ["sentiment", "isNegative", "summary"] },
        maxToolCalls: 1,
      },
      retryPolicy: LLM_RETRY,
    },
    { id: "decision_negative", type: "DECISION", label: "Unhappy?" },
    {
      id: "owner_follow_up",
      type: "HUMAN_TASK",
      label: "Owner follows up personally",
      config: { taskType: "follow_up_unhappy_customer", assigneeRole: "ADMIN", description: "The customer's reply to the review request sounds unhappy (see the reply in the workflow details). Contact them personally and put it right, then mark this done.", terminal: true },
    },
    { id: "note_positive", type: "ACTION", stepKey: "addTimelineNote", label: "Note the friendly reply", config: { params: { clientId: ref("load_invoice.clientId"), summary: "Customer replied to the review request", workflow: "Review request" }, terminal: true } },
    {
      id: "send_reminder",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "One gentle reminder",
      config: { template: "review_reminder", params: { to: ref("load_invoice.clientEmail"), variables: { clientFirstName: ref("load_invoice.clientFirstName"), title: ref("load_invoice.jobTitle"), reviewUrl: ref("load_invoice.reviewUrl") } } },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "note_reminded", type: "ACTION", stepKey: "addTimelineNote", label: "Note the reminder", config: { params: { clientId: ref("load_invoice.clientId"), summary: "Review reminder emailed", workflow: "Review request" }, terminal: true } },
    { id: "skip", type: "ACTION", stepKey: "logAudit", label: "No email - skip", config: { event: "review_skipped_no_email", params: { invoiceId: ref("trigger.invoiceId") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "load_invoice" },
    { from: "load_invoice", to: "decision_email" },
    { from: "decision_email", to: "send_review", when: { field: "load_invoice.hasEmail", op: "eq", value: true }, label: "Has email" },
    { from: "decision_email", to: "skip", label: "No email" },
    { from: "send_review", to: "wait_2" },
    { from: "wait_2", to: "check_replies" },
    { from: "check_replies", to: "decision_replied" },
    { from: "decision_replied", to: "classify", when: { field: "check_replies.messages.0", op: "exists" }, label: "They replied" },
    { from: "decision_replied", to: "send_reminder", label: "No reply" },
    { from: "classify", to: "decision_negative" },
    { from: "decision_negative", to: "owner_follow_up", when: { field: "classify.isNegative", op: "eq", value: true }, label: "Unhappy" },
    { from: "decision_negative", to: "note_positive", label: "Happy" },
    { from: "send_reminder", to: "note_reminded" },
  ],
);
