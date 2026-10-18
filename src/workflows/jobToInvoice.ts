import { defineWorkflow, ref } from "./build";

export const JOB_TO_INVOICE_ID = "def_ironspark_job_to_invoice";

/** Job to invoice: started when a job is marked complete. The invoice is drafted from the quote, approved variations and any
 * deposit; a person checks or edits it, and approving issues it - the invoice follow-up then emails it to the customer with the
 * PDF attached and our bank details, and chases it if it is not paid. Rejecting leaves the draft for the office to finish by hand. */
export const jobToInvoice = defineWorkflow(
  { id: JOB_TO_INVOICE_ID, name: "Job to invoice" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "A job was completed", config: { fields: [{ name: "jobId", description: "The job's id", example: "", required: true }] } },
    { id: "draft", type: "ACTION", stepKey: "draftInvoice", label: "Draft the invoice", config: { params: { jobId: ref("trigger.jobId") } } },
    { id: "decision_drafted", type: "DECISION", label: "Invoice drafted?" },
    {
      id: "approve_invoice",
      type: "HUMAN_TASK",
      label: "Office checks the draft invoice",
      config: {
        taskType: "approve_invoice",
        assigneeRole: "EDITOR",
        approval: true,
        reviewsNodeId: "send_invoice",
        description: "Check the invoice below. Open it to change lines, prices or notes, then come back here: approve to send it to the customer (PDF attached), or reject to finish it by hand.",
      },
    },
    { id: "decision_approved", type: "DECISION", label: "Approved?" },
    { id: "send_invoice", type: "ACTION", stepKey: "sendInvoice", label: "Issue and send the invoice", config: { params: { invoiceId: ref("draft.invoiceId") } } },
    { id: "decision_sent", type: "DECISION", label: "Sent?" },
    { id: "log_sent", type: "ACTION", stepKey: "logAudit", label: "Invoice sent", config: { event: "invoice_sent_after_job", params: { invoiceId: ref("draft.invoiceId") }, terminal: true } },
    {
      id: "finish_by_hand",
      type: "HUMAN_TASK",
      label: "Finish the invoice by hand",
      config: { taskType: "finish_invoice_by_hand", assigneeRole: "EDITOR", description: "The invoice could not be sent automatically (see the run for the reason). Open it under Invoices, fix it and issue it, then mark this done.", terminal: true },
    },
    { id: "log_left_draft", type: "ACTION", stepKey: "logAudit", label: "Left as a draft", config: { event: "invoice_left_as_draft", params: { invoiceId: ref("draft.invoiceId") }, terminal: true } },
    { id: "log_skipped", type: "ACTION", stepKey: "logAudit", label: "No invoice drafted", config: { event: "invoice_not_drafted", params: { reason: ref("draft.reason") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "draft" },
    { from: "draft", to: "decision_drafted" },
    { from: "decision_drafted", to: "approve_invoice", when: { field: "draft.created", op: "eq", value: true }, label: "Drafted" },
    { from: "decision_drafted", to: "log_skipped", label: "Not drafted" },
    { from: "approve_invoice", to: "decision_approved" },
    { from: "decision_approved", to: "send_invoice", when: { field: "approve_invoice.approved", op: "eq", value: true }, label: "Approved" },
    { from: "decision_approved", to: "log_left_draft", label: "Rejected - finish by hand" },
    { from: "send_invoice", to: "decision_sent" },
    { from: "decision_sent", to: "log_sent", when: { field: "send_invoice.sent", op: "eq", value: true }, label: "Sent" },
    { from: "decision_sent", to: "finish_by_hand", label: "Could not send" },
  ],
);
