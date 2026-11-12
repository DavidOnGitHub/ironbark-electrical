import type { SecurityReport as Report } from "../domain/it";
import { ScanNowButton } from "./ScanNowButton";

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "text-red-700 dark:text-red-400",
  HIGH: "text-red-700 dark:text-red-400",
  MEDIUM: "text-amber-700 dark:text-amber-400",
  LOW: "text-muted-foreground",
  INFO: "text-muted-foreground",
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const when = (d: Date) => d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The Security tab's report: what is open now by severity, the last scan, the worst findings and the trend. */
export function SecurityReport({ report, canScan = false }: { report: Report; canScan?: boolean }) {
  if (!report.lastScanAt) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-foreground/10 p-3" data-testid="security-report">
        <p className="text-sm text-muted-foreground">No scan has reported yet. Scans run every Monday.</p>
        {canScan ? <ScanNowButton /> : null}
      </section>
    );
  }
  const peak = Math.max(1, ...report.trend.map((t) => t.total));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-foreground/10 p-3" data-testid="security-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{report.openTotal === 0 ? "Nothing open" : `${report.openTotal} open ${report.openTotal === 1 ? "finding" : "findings"}`}</h2>
        <div className="flex items-start gap-3">
          <p className="text-xs text-muted-foreground">Last scan {when(report.lastScanAt)} ({report.lastScanKind})</p>
          {canScan ? <ScanNowButton /> : null}
        </div>
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {report.openBySeverity.map((s) => (
          <li key={s.severity} className="rounded-md border px-2 py-1">
            <span className={SEVERITY_TONE[s.severity]}>{label(s.severity)}</span> <span className="tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
      {report.trend.length > 1 ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Findings per scan, oldest to newest</p>
          <div className="flex h-10 items-end gap-1" role="img" aria-label={`Findings per scan: ${report.trend.map((t) => t.total).join(", ")}`}>
            {report.trend.map((t) => (
              <div key={t.id} title={`${when(t.at)}: ${t.total}`} className="w-4 rounded-sm bg-foreground/30" style={{ height: `${Math.max(4, (t.total / peak) * 100)}%` }} />
            ))}
          </div>
        </div>
      ) : null}
      {report.top.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {report.top.map((f) => (
            <li key={f.id} className="text-sm">
              <p>
                <span className={`font-medium ${SEVERITY_TONE[f.severity]}`}>{label(f.severity)}</span> - {f.message}
              </p>
              <p className="text-xs text-muted-foreground">
                {f.tool}{f.file ? ` - ${f.file}` : ""} - seen {f.seenCount} {f.seenCount === 1 ? "time" : "times"}
                {f.itRequestNumber ? ` - being fixed in ${f.itRequestNumber}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
