import { defineWorkflow, ref } from "./build";

export const VISIT_TO_QUOTE_ID = "def_ironspark_visit_to_quote";

/** Site visit to quote: started when the electrician records what they found. A draft quote is built from the enquiry and
 * those findings (using only the price list), a person checks or edits it, and approving sends it; the quote follow-up
 * then emails it to the customer and chases. Rejecting leaves the draft for the office to finish by hand. */
export const visitToQuote = defineWorkflow(
  { id: VISIT_TO_QUOTE_ID, name: "Site visit to quote" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "A site visit was finished", config: { fields: [{ name: "visitId", description: "The site visit's id", example: "", required: true }] } },
    { id: "draft", type: "ACTION", stepKey: "draftQuote", label: "Draft the quote from the findings", config: { params: { visitId: ref("trigger.visitId") } } },
    { id: "decision_drafted", type: "DECISION", label: "Quote drafted?" },
    {
      id: "approve_quote",
      type: "HUMAN_TASK",
      label: "Office checks the draft quote",
      config: {
        taskType: "approve_quote",
        assigneeRole: "EDITOR",
        approval: true,
        reviewsNodeId: "send_quote",
        description: "Check the quote below. Open it to change lines, prices or notes, then come back here: approve to send it to the customer, or reject to finish it by hand.",
      },
    },
    { id: "decision_approved", type: "DECISION", label: "Approved?" },
    { id: "send_quote", type: "ACTION", stepKey: "sendQuote", label: "Send the quote", config: { params: { quoteId: ref("draft.quoteId") } } },
    { id: "decision_sent", type: "DECISION", label: "Sent?" },
    { id: "log_sent", type: "ACTION", stepKey: "logAudit", label: "Quote sent", config: { event: "quote_sent_after_visit", params: { quoteId: ref("draft.quoteId") }, terminal: true } },
    {
      id: "finish_by_hand",
      type: "HUMAN_TASK",
      label: "Finish the quote by hand",
      config: { taskType: "finish_quote_by_hand", assigneeRole: "EDITOR", description: "The quote could not be sent automatically (see the run for the reason). Open the quote under Quotes, fix it and send it, then mark this done.", terminal: true },
    },
    { id: "log_left_draft", type: "ACTION", stepKey: "logAudit", label: "Left as a draft", config: { event: "quote_left_as_draft", params: { quoteId: ref("draft.quoteId") }, terminal: true } },
    { id: "log_skipped", type: "ACTION", stepKey: "logAudit", label: "No quote drafted", config: { event: "quote_not_drafted", params: { reason: ref("draft.reason") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "draft" },
    { from: "draft", to: "decision_drafted" },
    { from: "decision_drafted", to: "approve_quote", when: { field: "draft.created", op: "eq", value: true }, label: "Drafted" },
    { from: "decision_drafted", to: "log_skipped", label: "Not drafted" },
    { from: "approve_quote", to: "decision_approved" },
    { from: "decision_approved", to: "send_quote", when: { field: "approve_quote.approved", op: "eq", value: true }, label: "Approved" },
    { from: "decision_approved", to: "log_left_draft", label: "Rejected - finish by hand" },
    { from: "send_quote", to: "decision_sent" },
    { from: "decision_sent", to: "log_sent", when: { field: "send_quote.sent", op: "eq", value: true }, label: "Sent" },
    { from: "decision_sent", to: "finish_by_hand", label: "Could not send" },
  ],
);
