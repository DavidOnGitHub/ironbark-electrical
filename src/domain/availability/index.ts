/** Availability module - the public API: which times the business can still take a booking. */
import { listBusyWindows as jobBusy } from "../jobs";
import { listBusyWindows as visitBusy } from "../siteVisits";
import { listTechnicians } from "../shared/staff";
import { addDaysKey, dayKey } from "../../lib/tz";
import { computeFreeSlots, type Slot } from "./rules";

export * from "./rules";

export const VISIT_MINUTES = 60;

export interface FreeSlotQuery {
  durationMinutes?: number;
  /** How many days ahead to look (calendar days from today). */
  days?: number;
  now?: Date;
  /** Technicians in preference order; everyone with the Technician role (alphabetically) when left out. */
  technicianIds?: string[];
}

/** Free start times for the next `days` days, across all technicians (the first free technician is the one booked). */
export async function freeSlots(query: FreeSlotQuery = {}): Promise<Slot[]> {
  const now = query.now ?? new Date();
  const days = query.days ?? 14;
  const fromDay = dayKey(now);
  const technicianIds = query.technicianIds ?? (await listTechnicians()).map((t) => t.id); // alphabetical: the preference order
  const from = new Date(now.getTime() - 86_400_000);
  const to = new Date(now.getTime() + (days + 2) * 86_400_000);
  const [jobs, visits] = await Promise.all([jobBusy(from, to), visitBusy(from, to)]);
  return computeFreeSlots({ technicianIds, busy: [...jobs, ...visits], fromDay, days, durationMinutes: query.durationMinutes ?? VISIT_MINUTES, now });
}

export { addDaysKey };
