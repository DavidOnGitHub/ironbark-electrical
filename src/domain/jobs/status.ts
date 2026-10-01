export type JobStatusValue = "UNSCHEDULED" | "SCHEDULED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "INVOICED" | "PAID";

export const JOB_STATUS_ORDER: JobStatusValue[] = ["UNSCHEDULED", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INVOICED", "PAID"];

export const JOB_STATUS_LABEL: Record<JobStatusValue, string> = {
  UNSCHEDULED: "To schedule",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  PAID: "Paid",
};

/** Office/Owner moves. Scheduling itself moves To schedule <-> Scheduled. Invoiced
 * and Paid are set by the invoicing module in the next phase. */
export const JOB_TRANSITIONS: Record<JobStatusValue, JobStatusValue[]> = {
  UNSCHEDULED: ["SCHEDULED"],
  SCHEDULED: ["IN_PROGRESS", "ON_HOLD", "UNSCHEDULED"],
  IN_PROGRESS: ["COMPLETED", "ON_HOLD"],
  ON_HOLD: ["SCHEDULED", "IN_PROGRESS"],
  COMPLETED: ["INVOICED"],
  INVOICED: ["PAID"],
  PAID: [],
};

/** What a technician may do to their own job from the field. */
export const TECHNICIAN_TRANSITIONS: Record<JobStatusValue, JobStatusValue[]> = {
  UNSCHEDULED: [],
  SCHEDULED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED", "ON_HOLD"],
  ON_HOLD: ["IN_PROGRESS"],
  COMPLETED: [],
  INVOICED: [],
  PAID: [],
};

export function canMoveJob(from: JobStatusValue, to: JobStatusValue): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function technicianCanMoveJob(from: JobStatusValue, to: JobStatusValue): boolean {
  return TECHNICIAN_TRANSITIONS[from].includes(to);
}

/** Open work: still to do or being done. */
export function isActiveJob(status: JobStatusValue): boolean {
  return status === "UNSCHEDULED" || status === "SCHEDULED" || status === "IN_PROGRESS" || status === "ON_HOLD";
}

/** Do two time windows overlap? Touching end-to-start does not count. */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
