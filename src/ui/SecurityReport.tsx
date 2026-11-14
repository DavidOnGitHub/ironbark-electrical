import type { DismissedFinding, ScanRun, SecurityReport as Report } from "../domain/it";
import { FindingActions, FixQueueControls, ReopenButton, RetryFixButton } from "./FindingActions";
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
export interface ScanSchedule {
  /** "Every week", "Never (manual only)", ... */
  label: string;
  nextText: string | null;
  /** Set when the configured value was not understood and weekly is used instead. */
  invalid: boolean;
}

export function SecurityReport({ report, canScan = false, schedule, dismissed = [], scanRun = null, pause = null, failedFixes = 0 }: { report: Report; canScan?: boolean; schedule?: ScanSchedule; dismissed?: DismissedFinding[]; scanRun?: ScanRun | null; pause?: string | null; failedFixes?: number }) {
  const frequency = schedule ? (
    <div className="text-xs text-muted-foreground">
      <p>Scheduled scans: {schedule.label.toLowerCase()}{schedule.nextText ? `. ${schedule.nextText}` : ""}</p>
      {schedule.invalid ? <p>The scan frequency setting was not understood, so scans run weekly.</p> : null}
    </div>
  ) : null;
  if (!report.lastScanAt) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-foreground/10 p-3" data-testid="security-report">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">No scan has reported yet.</p>
          {canScan ? <ScanNowButton running={scanRun !== null} since={scanRun ? scanRun.since.toISOString() : null} runUrl={scanRun?.url ?? null} /> : null}
        </div>
        {frequency}
      </section>
    );
  }
  const peak = Math.max(1, ...report.trend.map((t) => t.total));
  // While a new scan runs, what is listed is the previous scan's: it can be read, not acted on.
  const readOnly = scanRun !== null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-foreground/10 p-3" data-testid="security-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{report.openTotal === 0 ? "Nothing open" : `${report.openTotal} open ${report.openTotal === 1 ? "finding" : "findings"}`}</h2>
        <div className="flex items-start gap-3">
          <p className="text-xs text-muted-foreground">Last scan {when(report.lastScanAt)} ({report.lastScanKind})</p>
          {canScan ? <ScanNowButton running={scanRun !== null} since={scanRun ? scanRun.since.toISOString() : null} runUrl={scanRun?.url ?? null} /> : null}
        </div>
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {report.openBySeverity.map((s) => (
          <li key={s.severity} className="rounded-md border px-2 py-1">
            <span className={SEVERITY_TONE[s.severity]}>{label(s.severity)}</span> <span className="tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
      {frequency}
      {readOnly ? (
        <p className="rounded-md border border-foreground/10 bg-muted px-3 py-2 text-sm" data-testid="security-read-only">
          A new scan is running. The findings below are from the previous scan and are history now: they cannot be fixed or dismissed. The results of the new scan will appear here when it finishes.
        </p>
      ) : null}
      {!readOnly && (pause || failedFixes > 0) ? (
        <div className="flex flex-col gap-2 rounded-md border border-status-warn/30 bg-status-warn-soft px-3 py-2 text-sm" data-testid="security-fix-pause">
          {pause ? <p>{pause}</p> : null}
          {failedFixes > 0 ? <p>{failedFixes === 1 ? "1 fix did not work" : `${failedFixes} fixes did not work`}: the assistant could not build a change. They can be tried again, now that the scan names the patched version.</p> : null}
          <FixQueueControls paused={Boolean(pause)} failedCount={failedFixes} />
        </div>
      ) : null}
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
                {f.itRequestNumber && !f.fixFailed ? ` - being fixed in ${f.itRequestNumber}` : ""}
                {f.fixFailed ? ` - the fix (${f.itRequestNumber}) did not work` : ""}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {readOnly ? null : f.fixFailed ? <RetryFixButton id={f.id} /> : null}
                {readOnly ? null : <FindingActions id={f.id} hasFix={f.hasFix} />}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {report.openTotal > report.top.length ? <p className="text-xs text-muted-foreground">And {report.openTotal - report.top.length} more, lower down the list.</p> : null}
      {dismissed.length > 0 ? (
        <details className="text-sm" data-testid="security-dismissed">
          <summary className="cursor-pointer text-xs text-muted-foreground">Dismissed ({dismissed.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {dismissed.map((d) => (
              <li key={d.id}>
                <p>
                  <span className="font-medium">{d.status === "ACCEPTED_RISK" ? "Risk accepted" : "False positive"}</span> - {d.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.tool}{d.file ? ` - ${d.file}` : ""}{d.by ? ` - by ${d.by}` : ""} - {when(d.at)}{d.reason ? ` - "${d.reason}"` : ""}
                </p>
                {readOnly ? null : (
                  <div className="mt-1">
                    <ReopenButton id={d.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {report.history.length > 0 ? (
        <details className="text-sm" data-testid="security-history">
          <summary className="cursor-pointer text-xs text-muted-foreground">History: earlier scans ({report.history.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {report.history.map((h) => (
              <li key={h.id}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {when(h.at)} ({h.kind}) - {h.total} {h.total === 1 ? "finding" : "findings"}
                  </summary>
                  {h.findings === null ? (
                    <p className="mt-1 text-xs text-muted-foreground">The details of this scan were not kept.</p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {h.findings.map((f, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className={`font-medium ${SEVERITY_TONE[f.severity]}`}>{label(f.severity)}</span> - {f.message} ({f.tool}{f.file ? ` - ${f.file}` : ""})
                        </li>
                      ))}
                      {h.total > h.findings.length ? <li className="text-xs text-muted-foreground">And {h.total - h.findings.length} more.</li> : null}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
