const HOUR_MS = 3_600_000;

export interface VisitInput {
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}

/**
 * The line under "Scheduled" on the jobs list: how long the booked visit is.
 *
 * DEMO: while the staging-only demo bug "job-schedule" is on (`demoBug`), this reads the end time for every job,
 * and a job that has not been scheduled yet has none, so it throws. The IT assistant's job in the demo is to find
 * that, add a test that fails, and fix it.
 */
export function visitNote(j: VisitInput, demoBug = false): string | null {
  if (demoBug) {
    const hours = Math.round((j.scheduledEnd!.getTime() - j.scheduledStart!.getTime()) / HOUR_MS);
    return `${hours} h visit`;
  }
  if (!j.scheduledStart || !j.scheduledEnd) return null;
  const hours = Math.round((j.scheduledEnd.getTime() - j.scheduledStart.getTime()) / HOUR_MS);
  return hours <= 0 ? null : `${hours} h visit`;
}
