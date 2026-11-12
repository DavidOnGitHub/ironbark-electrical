import Link from "next/link";
import type { SecurityHeadline } from "../domain/it";

const NAMES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The dashboard's flag for the security scan: shown when anything is open. Red for high or critical, amber for medium,
 * and quiet blue for the rest. Says how many, how bad, and how many already have a fix under way; links to the detail.
 */
export function SecurityBanner({ headline }: { headline: SecurityHeadline }) {
  const urgent = headline.bySeverity.CRITICAL + headline.bySeverity.HIGH > 0;
  const tone = urgent ? "border-status-bad/30 bg-status-bad-soft" : headline.worst === "MEDIUM" ? "border-status-warn/30 bg-status-warn-soft" : "border-status-info/30 bg-status-info-soft";
  const parts = NAMES.filter((s) => headline.bySeverity[s] > 0).map((s) => `${headline.bySeverity[s]} ${s.toLowerCase()}`);
  const waiting = headline.open - headline.beingFixed;
  return (
    <div role={urgent ? "alert" : "status"} className={`flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 ${tone}`} data-testid="security-banner">
      <p className="min-w-56 flex-1">
        <strong>{plural(headline.open, "security issue", "security issues")} found by the latest scan</strong> ({parts.join(", ")}).{" "}
        {headline.beingFixed > 0 ? `${plural(headline.beingFixed, "is", "are")} being fixed${waiting > 0 ? `; ${waiting} still ${waiting === 1 ? "needs" : "need"} a look.` : "."}` : "None have a fix under way yet."}
      </p>
      <Link href="/it?tab=security" className="inline-flex h-9 items-center rounded bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
        See the issues
      </Link>
    </div>
  );
}
