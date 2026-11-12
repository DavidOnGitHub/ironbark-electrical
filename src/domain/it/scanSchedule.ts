/**
 * How often the scheduled security scan runs, set by the IT_SCAN_FREQUENCY environment variable on the web service:
 * weekly (the default), fortnightly, monthly or never. The GitHub workflow wakes up every day and asks the app whether
 * a scan is due; the app answers from this value and the time of the last scan, so changing the frequency is a change
 * of one variable in Render, with no edit to the workflow. "Scan now" ignores it, and a manual scan restarts the clock.
 */
import { appDb } from "../../db/app";

export const SCAN_FREQUENCIES = ["weekly", "fortnightly", "monthly", "never"] as const;
export type ScanFrequency = (typeof SCAN_FREQUENCIES)[number];
export const DEFAULT_SCAN_FREQUENCY: ScanFrequency = "weekly";
export const SCAN_FREQUENCY_LABEL: Record<ScanFrequency, string> = { weekly: "Every week", fortnightly: "Every two weeks", monthly: "Every month", never: "Never (manual only)" };

const DAY_MS = 86_400_000;
const INTERVAL_DAYS: Record<Exclude<ScanFrequency, "never">, number> = { weekly: 7, fortnightly: 14, monthly: 30 };
/** The daily check can land a little before the exact interval has passed (the last scan finished some minutes after the check). */
const TOLERANCE_MS = 12 * 3_600_000;

type Env = Record<string, string | undefined>;

/** The configured frequency. Empty or unrecognised means weekly: a typo must not quietly switch scanning off. */
export function scanFrequency(env: Env = process.env): ScanFrequency {
  const v = env.IT_SCAN_FREQUENCY?.trim().toLowerCase();
  return (SCAN_FREQUENCIES as readonly string[]).includes(v ?? "") ? (v as ScanFrequency) : DEFAULT_SCAN_FREQUENCY;
}

/** True when a value was set but is not one of the four, so the page can say it fell back to weekly. */
export const scanFrequencyInvalid = (env: Env = process.env): boolean => Boolean(env.IT_SCAN_FREQUENCY?.trim()) && !(SCAN_FREQUENCIES as readonly string[]).includes(env.IT_SCAN_FREQUENCY!.trim().toLowerCase());

export interface ScanDue {
  due: boolean;
  frequency: ScanFrequency;
  reason: string;
}

/** Whether the daily check should run a scan today. */
export async function scanDue(now: Date = new Date(), env: Env = process.env): Promise<ScanDue> {
  const frequency = scanFrequency(env);
  if (frequency === "never") return { due: false, frequency, reason: "Scheduled scans are switched off" };
  const last = await appDb.securityScan.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  if (!last) return { due: true, frequency, reason: "No scan has run yet" };
  const wait = INTERVAL_DAYS[frequency] * DAY_MS - TOLERANCE_MS;
  return now.getTime() - last.receivedAt.getTime() >= wait ? { due: true, frequency, reason: "The last scan is old enough" } : { due: false, frequency, reason: "The last scan is recent enough" };
}

/** When the next scheduled scan will happen, at the earliest. Null when there is none to expect. */
export function nextScanAfter(frequency: ScanFrequency, lastScanAt: Date | null): Date | null {
  if (frequency === "never" || !lastScanAt) return null;
  return new Date(lastScanAt.getTime() + INTERVAL_DAYS[frequency] * DAY_MS - TOLERANCE_MS);
}
