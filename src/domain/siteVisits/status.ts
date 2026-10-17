export const SITE_VISIT_STATUS_LABEL = { SCHEDULED: "Booked", COMPLETED: "Done", CANCELLED: "Cancelled" } as const;
export type SiteVisitStatusValue = keyof typeof SITE_VISIT_STATUS_LABEL;
