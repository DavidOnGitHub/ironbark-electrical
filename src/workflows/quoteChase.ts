import { DAYS, defineWorkflow, GMAIL_RETRY, HOURS, ref } from "./build";

export const QUOTE_CHASE_ID = "def_ironspark_quote_chase";

/** Quote and chase: started when a quote is marked as sent. Emails the quote, waits a day, nudges
 * once, waits three more days, then asks the owner to phone. Stops the moment the customer answers. */
export const quoteChase = defineWorkflow(
  { id: QUOTE_CHASE_ID, name: "Quote and chase" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "A quote was sent", config: { fields: [{ name: "quoteId", description: "The quote's id", example: "", required: true }] } },
    { id: "load_quote", type: "ACTION", stepKey: "getQuote", label: "Read the quote", config: { params: { quoteId: ref("trigger.quoteId") } } },
    { id: "decision_email", type: "DECISION", label: "Do we have their email?" },
    {
      id: "send_quote",
      type: "ACTION",
      stepKey: "sendEmail",
      label: "Email the quote",
      config: { params: { to: ref("load_quote.clientEmail"), subject: ref("load_quote.emailSubject"), body: ref("load_quote.emailBody") } },
      retryPolicy: GMAIL_RETRY,
      onFailureNodeId: "send_by_hand",
    },
    {
      id: "send_by_hand",
      type: "HUMAN_TASK",
      label: "Send the quote by hand",
      config: { taskType: "send_quote_by_hand", assigneeRole: "EDITOR", description: "The quote could not be emailed automatically (no email address, or sending failed). Send it to the customer yourself, then mark this done.", terminal: true },
    },
    { id: "note_sent", type: "ACTION", stepKey: "addTimelineNote", label: "Note it on the client's history", config: { params: { clientId: ref("load_quote.clientId"), summary: "Quote emailed to the customer", workflow: "Quote and chase" } } },
    { id: "wait_1", type: "DELAY", label: "Wait one day", config: { seconds: 1 * DAYS } },
    { id: "check_1", type: "ACTION", stepKey: "getQuote", label: "Has the customer answered?", config: { params: { quoteId: ref("trigger.quoteId") } } },
    { id: "decision_open_1", type: "DECISION", label: "Still waiting?" },
    {
      id: "reminder",
      type: "ACTION",
      stepKey: "sendEmail",
      label: "Send a friendly reminder",
      config: { params: { to: ref("load_quote.clientEmail"), subject: ref("load_quote.reminderSubject"), body: ref("load_quote.reminderBody") } },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "note_reminded", type: "ACTION", stepKey: "addTimelineNote", label: "Note the reminder", config: { params: { clientId: ref("load_quote.clientId"), summary: "Reminder emailed about the quote", workflow: "Quote and chase" } } },
    { id: "wait_2", type: "DELAY", label: "Wait three days", config: { seconds: 3 * DAYS } },
    { id: "check_2", type: "ACTION", stepKey: "getQuote", label: "Answered by now?", config: { params: { quoteId: ref("trigger.quoteId") } } },
    { id: "decision_open_2", type: "DECISION", label: "Still waiting?" },
    {
      id: "owner_call",
      type: "HUMAN_TASK",
      label: "Owner phones the customer",
      config: { taskType: "call_about_quote", assigneeRole: "ADMIN", description: "The quote has had no answer after a reminder. Phone the customer, record their answer on the quote, then mark this done.", terminal: true },
    },
    { id: "note_answered_1", type: "ACTION", stepKey: "addTimelineNote", label: "Stop - they answered", config: { params: { clientId: ref("load_quote.clientId"), summary: "Customer answered the quote - chasing stopped", workflow: "Quote and chase" }, terminal: true } },
    { id: "note_answered_2", type: "ACTION", stepKey: "addTimelineNote", label: "Stop - they answered", config: { params: { clientId: ref("load_quote.clientId"), summary: "Customer answered the quote after the reminder - chasing stopped", workflow: "Quote and chase" }, terminal: true } },
  ],
  [
    { from: "trigger", to: "load_quote" },
    { from: "load_quote", to: "decision_email" },
    { from: "decision_email", to: "send_quote", when: { field: "load_quote.hasEmail", op: "eq", value: true }, label: "Has email" },
    { from: "decision_email", to: "send_by_hand", label: "No email" },
    { from: "send_quote", to: "note_sent" },
    { from: "note_sent", to: "wait_1" },
    { from: "wait_1", to: "check_1" },
    { from: "check_1", to: "decision_open_1" },
    { from: "decision_open_1", to: "reminder", when: { field: "check_1.isOpen", op: "eq", value: true }, label: "No answer yet" },
    { from: "decision_open_1", to: "note_answered_1", label: "Answered" },
    { from: "reminder", to: "note_reminded" },
    { from: "note_reminded", to: "wait_2" },
    { from: "wait_2", to: "check_2" },
    { from: "check_2", to: "decision_open_2" },
    { from: "decision_open_2", to: "owner_call", when: { field: "check_2.isOpen", op: "eq", value: true }, label: "Still no answer" },
    { from: "decision_open_2", to: "note_answered_2", label: "Answered" },
  ],
);
void HOURS;
