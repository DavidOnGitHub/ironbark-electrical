import type { RequestStatus } from "iron-spark-client";

/** Allowed moves of the enquiry pipeline. Won normally comes from an approved
 * quote (Phase 2) but a person may also mark it by hand; Lost can be reopened. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  NEW: ["CONTACTED", "SITE_VISIT_BOOKED", "QUOTED", "LOST"],
  CONTACTED: ["SITE_VISIT_BOOKED", "QUOTED", "LOST"],
  SITE_VISIT_BOOKED: ["QUOTED", "LOST"],
  QUOTED: ["CONTACTED", "WON", "LOST"],
  WON: [],
  LOST: ["NEW"],
};

export const REQUEST_STATUS_ORDER: RequestStatus[] = ["NEW", "CONTACTED", "SITE_VISIT_BOOKED", "QUOTED", "WON", "LOST"];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_VISIT_BOOKED: "Site visit booked",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
};

/** Won and Lost are closed; everything else is still open work. */
export function isOpenStatus(status: RequestStatus): boolean {
  return status !== "WON" && status !== "LOST";
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** Hours since the request was received (never negative). */
export function requestAgeHours(receivedAt: Date, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - receivedAt.getTime()) / 3_600_000);
}

/** "12 min", "3 h", "2 d" - the pipeline's age chip. */
export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}
