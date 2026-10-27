import { defineWorkflow, ref } from "./build";

export const JOB_TO_INVOICE_ID = "def_ironspark_job_to_invoice";

/** Job to invoice: started when a job is marked complete. The invoice is drafted from the quote, approved variations and any
 * deposit, then left for the office: they check or edit it on the invoice page and click "Issue invoice", which issues it at
 * once and starts the invoice follow-up (the one approval to email it to the customer, then the payment chase). */
export const jobToInvoice = defineWorkflow(
  { id: JOB_TO_INVOICE_ID, name: "Job to invoice" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "A job was completed", config: { fields: [{ name: "jobId", description: "The job's id", example: "", required: true }] } },
    { id: "draft", type: "ACTION", stepKey: "draftInvoice", label: "Draft the invoice", config: { params: { jobId: ref("trigger.jobId") } } },
    { id: "decision_drafted", type: "DECISION", label: "Invoice drafted?" },
    { id: "log_drafted", type: "ACTION", stepKey: "logAudit", label: "Draft ready for the office to issue", config: { event: "invoice_drafted", params: { invoiceId: ref("draft.invoiceId") }, terminal: true } },
    { id: "log_skipped", type: "ACTION", stepKey: "logAudit", label: "No invoice drafted", config: { event: "invoice_not_drafted", params: { reason: ref("draft.reason") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "draft" },
    { from: "draft", to: "decision_drafted" },
    { from: "decision_drafted", to: "log_drafted", when: { field: "draft.created", op: "eq", value: true }, label: "Drafted" },
    { from: "decision_drafted", to: "log_skipped", label: "Not drafted" },
  ],
);
