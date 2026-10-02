/** "Works for..." notes: how each part of this demo maps onto other kinds of business (requirements DR-5).
 * Plain data, so the page and the tests share one source. Keep claims to what the platform really does. */

export const MODULES = ["Enquiries", "Clients", "Quotes", "Work and schedule", "Invoices and payments", "Automations"] as const;
export type ModuleName = (typeof MODULES)[number];

export interface Industry {
  id: string;
  name: string;
  /** One line on why this business looks like Ironbark. */
  pitch: string;
  /** What each module is called and does in this business. */
  mapping: Record<ModuleName, { theirs: string; note: string }>;
  /** The first process we would automate for them. */
  firstAutomation: string;
  /** What we would change or build, beyond renaming. */
  customise: string[];
}

export const INDUSTRIES: Industry[] = [
  {
    id: "clinic",
    name: "Clinic (physio, dental, allied health)",
    pitch: "Patients enquire, get booked, are seen, and pay - with reminders in between. Same flow, different words.",
    mapping: {
      Enquiries: { theirs: "New patient enquiries", note: "Phone, email and web-form enquiries land in one inbox with an age clock, so none go unanswered." },
      Clients: { theirs: "Patients", note: "One record with contact details and a timeline of everything that happened. Roles control who sees what; finer clinical-note access would be tailored." },
      Quotes: { theirs: "Treatment plans and fee estimates", note: "Itemised estimate with GST, sent for approval, with a follow-up if the patient goes quiet." },
      "Work and schedule": { theirs: "Appointments", note: "Practitioners instead of technicians: one calendar with conflict checks, and a phone view for the day's list." },
      "Invoices and payments": { theirs: "Invoices and card payments", note: "Invoice after the visit, pay-by-link, overdue chasing. Health-fund claiming would be a separate integration." },
      Automations: { theirs: "Reminders and recalls", note: "Reminders, recalls and review requests can be built from the same wait, email and approval steps the demo uses for quote and invoice chasing." },
    },
    firstAutomation: "Appointment reminders, to cut no-shows without front-desk calls.",
    customise: ["Patient fields and consent notes", "Practitioner roles and who can see clinical notes", "Health-fund or practice-management integration, if needed"],
  },
  {
    id: "cleaning",
    name: "Cleaning company",
    pitch: "Quote a clean, schedule crews to sites, invoice on completion, chase late payers. Repeat clients make it even better.",
    mapping: {
      Enquiries: { theirs: "Quote requests", note: "Emails and web enquiries are logged and answered with an approved reply, so the first response is fast." },
      Clients: { theirs: "Clients and sites", note: "A client with many sites already works here, with access notes per site (keys, alarm codes, parking)." },
      Quotes: { theirs: "Quotes and recurring service quotes", note: "Priced from a list of standard clean types and rates; recurring schedules would be a build on top." },
      "Work and schedule": { theirs: "Cleans and crew rosters", note: "Crews take the technician role with a phone view: addresses, access notes, tick off, add notes and extras." },
      "Invoices and payments": { theirs: "Invoices", note: "Invoice from the completed clean, with extras added as variations, and automatic reminders if unpaid." },
      Automations: { theirs: "Follow-ups and re-bookings", note: "Quote chase, review request after a clean, and a prompt to rebook a quarterly deep clean." },
    },
    firstAutomation: "Quote follow-up, which the demo already does: unanswered quotes are a common leak.",
    customise: ["Recurring bookings and generated rosters", "Per-site checklists with photos", "Pricing by area or hours"],
  },
  {
    id: "agency",
    name: "Agency or professional services",
    pitch: "Proposals, projects and invoices. The 'job' is a project, and the 'technician' is whoever delivers it.",
    mapping: {
      Enquiries: { theirs: "Leads and briefs", note: "Inbound email is read, categorised and answered with a draft for you to approve, before it goes out." },
      Clients: { theirs: "Clients and contacts", note: "Client records with contact details and a timeline of every email, proposal and invoice." },
      Quotes: { theirs: "Proposals", note: "Itemised proposals with an approval step and a validity date, then a follow-up when they stall." },
      "Work and schedule": { theirs: "Projects and milestones", note: "Projects with an owner, status and notes; scheduling matters less, so the board and notes do the work." },
      "Invoices and payments": { theirs: "Milestone and monthly invoices", note: "Deposit up front, milestone invoices, card payment links and overdue chasing already work." },
      Automations: { theirs: "Onboarding and check-ins", note: "A kick-off task when a proposal is approved and a periodic check-in task per client can be built with the same human-task steps." },
    },
    firstAutomation: "Proposal follow-up and a kick-off checklist the moment a proposal is approved.",
    customise: ["Time tracking against projects", "Retainers and recurring invoices", "Client portal for approvals"],
  },
  {
    id: "wholesaler",
    name: "Wholesaler or distributor",
    pitch: "Orders in, stock to ship, invoice out, collect payment. Heavier on products, lighter on appointments.",
    mapping: {
      Enquiries: { theirs: "Order requests and quote requests", note: "Emailed requests are logged against the right customer, so nothing lives in someone's inbox." },
      Clients: { theirs: "Trade accounts", note: "Accounts with delivery sites, contacts and payment terms, plus a history of everything sent." },
      Quotes: { theirs: "Quotes and standing price lists", note: "Price list drives quotes; per-customer pricing would be a customisation." },
      "Work and schedule": { theirs: "Orders and deliveries", note: "Job status becomes order status (picked, dispatched, delivered). Stock levels would be a new module or an integration." },
      "Invoices and payments": { theirs: "Invoices and statements", note: "Invoice on dispatch, pay-by-link, overdue cadence. Accounting sync (Xero or MYOB) would be added." },
      Automations: { theirs: "Order confirmations and credit chasing", note: "Order confirmations and payment reminders on trade terms follow the demo's chase pattern; a credit hold on far-overdue accounts would be a small build." },
    },
    firstAutomation: "Overdue-invoice chasing with a credit hold, which protects cash flow straight away.",
    customise: ["Stock and product catalogue", "Accounting integration (Xero, MYOB)", "Per-customer pricing and order forms"],
  },
  {
    id: "trades",
    name: "Other trades (plumber, HVAC, builder)",
    pitch: "This is the demo itself with a different price list. The quickest of all to stand up.",
    mapping: {
      Enquiries: { theirs: "Service requests", note: "Urgent faults flagged and surfaced first, with emergency and routine handled differently." },
      Clients: { theirs: "Customers and properties", note: "Sites with access and equipment notes, so the tech arrives knowing what is there." },
      Quotes: { theirs: "Quotes with deposits", note: "Itemised from a price list, deposit threshold, approval, and a follow-up on silence." },
      "Work and schedule": { theirs: "Jobs and the crew calendar", note: "Schedule with conflict checks, and a phone day-view with call, directions and variations." },
      "Invoices and payments": { theirs: "Invoices with deposit credit", note: "Variations flow into the invoice, card payment link, automatic overdue chasing." },
      Automations: { theirs: "The same four workflows", note: "Enquiry reply, quote chase, invoice chase and review request, edited for the trade's wording." },
    },
    firstAutomation: "Enquiry reply: an after-hours enquiry gets a polite answer in minutes, not the next morning.",
    customise: ["Price list and trade-specific wording", "Compliance paperwork (certificates, safety checklists)", "Supplier ordering"],
  },
];

export function findIndustry(id: string | undefined): Industry | undefined {
  return INDUSTRIES.find((i) => i.id === id);
}

/** What is the same whatever the business, and what we tailor. Shown above the industry notes. */
export const SAME_EVERYWHERE = [
  "People and roles: owner, office, field staff, bookkeeper, each seeing only what they should.",
  "A record per client with a timeline of everything that happened.",
  "Enquiry to quote to work to invoice to payment, with real email and card payments.",
  "Automations you can read and edit: triggers, decisions, approvals and waits.",
];
