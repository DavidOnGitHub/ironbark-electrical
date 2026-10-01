import type { UserRole } from "@kabosh-digital/workflow-schema";

/**
 * Who may do what in the business app (requirements section 7). Roles are the
 * platform's four; the business labels them Owner / Office / Technician /
 * Bookkeeper (see instrumentation.ts). Pages guard with requirePageRole and
 * actions with requireRole using these lists - never only in the UI.
 */
const OWNER = "ADMIN" as UserRole;
const OFFICE = "EDITOR" as UserRole;
const TECHNICIAN = "OPERATOR" as UserRole;
const BOOKKEEPER = "VIEWER" as UserRole;

export const Access = {
  /** Read clients, sites and their history. */
  CLIENTS_READ: [OWNER, OFFICE, BOOKKEEPER],
  /** Create and edit clients, sites and notes. */
  CLIENTS_WRITE: [OWNER, OFFICE],
  /** The enquiry pipeline. */
  REQUESTS: [OWNER, OFFICE],
  /** The dashboard of the business. */
  DASHBOARD: [OWNER, OFFICE, BOOKKEEPER],
  /** The price list. Technicians never see prices. */
  PRICING: [OWNER, OFFICE],
  INVOICES_READ: [OWNER, OFFICE, BOOKKEEPER],
  INVOICES_WRITE: [OWNER, OFFICE],
  QUOTES_READ: [OWNER, OFFICE, BOOKKEEPER],
  QUOTES_WRITE: [OWNER, OFFICE],
  JOBS_READ: [OWNER, OFFICE, BOOKKEEPER],
  JOBS_WRITE: [OWNER, OFFICE],
  /** The field: a technician's own jobs. */
  FIELD: [TECHNICIAN],
  /** A technician's own day. */
  MY_DAY: [TECHNICIAN, OWNER, OFFICE],
} satisfies Record<string, UserRole[]>;

export const Roles = { OWNER, OFFICE, TECHNICIAN, BOOKKEEPER };
