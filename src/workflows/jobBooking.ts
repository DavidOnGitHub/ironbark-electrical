import { defineWorkflow, GMAIL_RETRY, ref } from "./build";

export const JOB_BOOKING_ID = "def_ironspark_job_booking";

/** Job booking: started when a customer who accepted a quote picks a day. That time is already held (nobody else can take it);
 * the office approves it, which puts the job in the technician's calendar and emails the customer, or declines it, which frees
 * the time and asks the customer to choose again. Email goes out automatically only to addresses the business allows. */
export const jobBooking = defineWorkflow(
  { id: JOB_BOOKING_ID, name: "Job booking" },
  [
    { id: "trigger", type: "TRIGGER", stepKey: "manual", label: "A customer picked a day", config: { fields: [{ name: "jobId", description: "The job's id", example: "", required: true }] } },
    { id: "load", type: "ACTION", stepKey: "getJobBooking", label: "Read the job and the time asked for", config: { params: { jobId: ref("trigger.jobId") } } },
    {
      id: "approve_booking",
      type: "HUMAN_TASK",
      label: "Office approves the day",
      config: { taskType: "approve_job_booking", assigneeRole: "EDITOR", approval: true, reviewsNodeId: "confirm", description: "The customer accepted the quote and picked the day below; it is held for them. Approve to book the job in the technician's calendar, or reject to free the time and ask them to choose again." },
    },
    { id: "decision_approved", type: "DECISION", label: "Approved?" },
    { id: "confirm", type: "ACTION", stepKey: "confirmJobBooking", label: "Book the job in the calendar", config: { params: { jobId: ref("trigger.jobId") } } },
    { id: "decision_confirmed", type: "DECISION", label: "Booked?" },
    { id: "decision_email", type: "DECISION", label: "May we email them automatically?" },
    {
      id: "send_confirmation",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Tell the customer they are booked in",
      config: {
        template: "job_booked",
        params: { to: ref("load.emailAddress"), variables: { clientFirstName: ref("load.clientFirstName"), title: ref("load.title"), whenText: ref("load.requestedText"), technician: ref("load.technician"), addressText: ref("load.addressText") } },
        terminal: true,
      },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "log_booked", type: "ACTION", stepKey: "logAudit", label: "Booked (no automatic email)", config: { event: "job_booked_no_email", params: { jobId: ref("trigger.jobId") }, terminal: true } },
    {
      id: "finish_by_hand",
      type: "HUMAN_TASK",
      label: "Book the job by hand",
      config: { taskType: "book_job_by_hand", assigneeRole: "EDITOR", description: "The day the customer picked could not be booked (see the run for the reason). Open the job under Jobs, schedule it and tell the customer, then mark this done.", terminal: true },
    },
    { id: "release", type: "ACTION", stepKey: "releaseJobBooking", label: "Free the time", config: { params: { jobId: ref("trigger.jobId") } } },
    { id: "decision_email_declined", type: "DECISION", label: "May we email them automatically?" },
    {
      id: "send_reschedule",
      type: "ACTION",
      stepKey: "sendTemplatedEmail",
      label: "Ask the customer to choose another day",
      config: {
        template: "job_reschedule",
        params: { to: ref("load.emailAddress"), variables: { clientFirstName: ref("load.clientFirstName"), title: ref("load.title"), requestedText: ref("load.requestedText"), acceptUrl: ref("load.acceptUrl") } },
        terminal: true,
      },
      retryPolicy: GMAIL_RETRY,
    },
    { id: "log_declined", type: "ACTION", stepKey: "logAudit", label: "Time freed (customer to be contacted)", config: { event: "job_time_declined_no_email", params: { jobId: ref("trigger.jobId") }, terminal: true } },
  ],
  [
    { from: "trigger", to: "load" },
    { from: "load", to: "approve_booking" },
    { from: "approve_booking", to: "decision_approved" },
    { from: "decision_approved", to: "confirm", when: { field: "approve_booking.approved", op: "eq", value: true }, label: "Approved" },
    { from: "decision_approved", to: "release", label: "Declined" },
    { from: "confirm", to: "decision_confirmed" },
    { from: "decision_confirmed", to: "decision_email", when: { field: "confirm.confirmed", op: "eq", value: true }, label: "Booked" },
    { from: "decision_confirmed", to: "finish_by_hand", label: "Could not book" },
    { from: "decision_email", to: "send_confirmation", when: { field: "load.hasEmail", op: "eq", value: true }, label: "Automatic" },
    { from: "decision_email", to: "log_booked", label: "No automatic email" },
    { from: "release", to: "decision_email_declined" },
    { from: "decision_email_declined", to: "send_reschedule", when: { field: "load.hasEmail", op: "eq", value: true }, label: "Automatic" },
    { from: "decision_email_declined", to: "log_declined", label: "No automatic email" },
  ],
);
