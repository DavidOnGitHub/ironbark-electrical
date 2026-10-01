/**
 * The business runs on Sydney time, whatever timezone the server is in.
 * Jobs are stored as UTC instants; days, weeks and form inputs are Sydney.
 */
export const TZ = "Australia/Sydney";

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-05" - the Sydney calendar day of an instant. */
export function dayKey(date: Date): string {
  return dateKeyFmt.format(date);
}

function zonedParts(date: Date) {
  const get = (type: string) => Number(partsFmt.formatToParts(date).find((p) => p.type === type)!.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Sydney wall-clock "2026-10-05T09:30" (a datetime-local value) -> the UTC instant. */
export function sydneyLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wantedAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Find the instant whose Sydney wall time equals the wanted one (two passes cover DST edges).
  let guess = wantedAsUtc;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess));
    const shownAsUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += wantedAsUtc - shownAsUtc;
  }
  const date = new Date(guess);
  const back = zonedParts(date);
  return back.h === h && back.mi === mi && back.d === d ? date : null;
}

/** A datetime-local value (Sydney wall time) for an instant. */
export function dateToSydneyLocal(date: Date): string {
  const p = zonedParts(date);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`;
}

/** Monday of the week containing the Sydney day `key` ("YYYY-MM-DD"). */
export function weekStartKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDaysKey(key, -dow);
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function weekDayKeys(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysKey(startKey, i));
}

/** The UTC instant at Sydney midnight at the start of day `key`. */
export function startOfDay(key: string): Date {
  return sydneyLocalToDate(`${key}T00:00`)!;
}

const fmtDay = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const fmtDayTime = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export const formatDay = (d: Date) => fmtDay.format(d);
export const formatTime = (d: Date) => fmtTime.format(d);
export const formatDayTime = (d: Date) => fmtDayTime.format(d);
export const formatDayKey = (key: string) => fmtDay.format(startOfDay(key));

/** "2026-10-06T" - tomorrow's Sydney date, as the prefix of a datetime-local default. */
export function tomorrowLocalPrefix(now: Date = new Date()): string {
  return `${addDaysKey(dayKey(now), 1)}T`;
}
