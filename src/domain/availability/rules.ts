/**
 * When can an electrician be booked? Pure rules - no database: working hours, a travel buffer
 * around every booking, a minimum notice, and a technician preference order (the first technician
 * who is free is the one booked, so a one-person business keeps its work with one person and a
 * second is only used when needed).
 */
import { addDaysKey, sydneyLocalToDate } from "../../lib/tz";

export interface AvailabilityConfig {
  /** Sydney working hours, whole hours: the day starts at `workStartHour` and work must finish by `workEndHour`. */
  workStartHour: number;
  workEndHour: number;
  /** 0 = Sunday ... 6 = Saturday. */
  workDays: number[];
  /** Slots start on multiples of this many minutes from the start of the day. */
  stepMinutes: number;
  /** Travel time kept free either side of any booking. */
  bufferMinutes: number;
  /** The earliest bookable time is this far from now. */
  leadHours: number;
}

export const DEFAULT_AVAILABILITY: AvailabilityConfig = { workStartHour: 8, workEndHour: 16, workDays: [1, 2, 3, 4, 5], stepMinutes: 60, bufferMinutes: 30, leadHours: 12 };

export interface BusyWindow {
  userId: string;
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  /** The technician who would attend (the first free one in preference order). */
  userId: string;
}

const MIN = 60_000;

/** Day of week (0 = Sunday) of a calendar day key like "2026-10-20". */
export function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00Z`).getUTCDay();
}

export function isFree(userId: string, start: Date, end: Date, busy: BusyWindow[], bufferMinutes: number): boolean {
  const from = start.getTime() - bufferMinutes * MIN;
  const to = end.getTime() + bufferMinutes * MIN;
  return !busy.some((b) => b.userId === userId && b.start.getTime() < to && from < b.end.getTime());
}

export interface FreeSlotsInput {
  /** Technicians in preference order. */
  technicianIds: string[];
  busy: BusyWindow[];
  /** First Sydney day to offer, as "YYYY-MM-DD". */
  fromDay: string;
  days: number;
  durationMinutes: number;
  now: Date;
  config?: Partial<AvailabilityConfig>;
}

/** Every start time that some technician can take, one entry per start. */
export function computeFreeSlots(input: FreeSlotsInput): Slot[] {
  const cfg = { ...DEFAULT_AVAILABILITY, ...input.config };
  const earliest = input.now.getTime() + cfg.leadHours * 60 * MIN;
  const slots: Slot[] = [];
  for (let i = 0; i < input.days; i++) {
    const day = addDaysKey(input.fromDay, i);
    if (!cfg.workDays.includes(weekdayOf(day))) continue;
    const dayStart = cfg.workStartHour * 60;
    const dayEnd = cfg.workEndHour * 60;
    for (let m = dayStart; m + input.durationMinutes <= dayEnd; m += cfg.stepMinutes) {
      const start = sydneyLocalToDate(`${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      if (!start || start.getTime() < earliest) continue;
      const end = new Date(start.getTime() + input.durationMinutes * MIN);
      const userId = input.technicianIds.find((id) => isFree(id, start, end, input.busy, cfg.bufferMinutes));
      if (userId) slots.push({ start, end, userId });
    }
  }
  return slots;
}

/** Groups slots by Sydney day key, for a calendar. */
export function groupByDay(slots: Slot[], dayKeyOf: (d: Date) => string): { day: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) map.set(dayKeyOf(s.start), [...(map.get(dayKeyOf(s.start)) ?? []), s]);
  return [...map].map(([day, list]) => ({ day, slots: list }));
}
