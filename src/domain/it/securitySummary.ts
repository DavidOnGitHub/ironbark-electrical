/**
 * The Security tab's report in plain English: what the latest scan found, what is open now, the most urgent thing,
 * what is being done and whether it is getting better. Built from the scan's own numbers, with no AI call, so it costs
 * nothing and cannot be steered by finding text. Like plain.ts it never shows code: no file names, rule ids or scanner
 * messages; a package name is the only thing taken from a finding.
 */
import { SEVERITIES, type Severity } from "./security";
import { packageOf } from "./triage";

/** What one scan changed, stored on the scan when it is applied. */
export interface ScanOutcome {
  /** Findings seen for the first time. */
  created: number;
  /** Findings that had been fixed and came back. */
  reopened: number;
  /** Earlier findings this scan no longer reported. */
  fixed: number;
  /** New and returning findings by severity. */
  newBySeverity: Partial<Record<Severity, number>>;
}

export interface SummaryScan {
  at: Date;
  kind: string;
  total: number;
  /** Null for scans applied before outcomes were stored. */
  outcome: ScanOutcome | null;
}

export interface SummaryFinding {
  severity: Severity;
  tool: string;
  status: string;
  message: string;
  fixedIn: string | null;
}

export interface SummaryInput {
  latest: SummaryScan;
  /** The scan before it of the same kind, to say whether things are getting better. */
  previous: SummaryScan | null;
  /** Open findings (open or being fixed). */
  open: SummaryFinding[];
}

const DEPENDENCY_TOOLS = ["osv", "pnpm-audit"];
// Read when called, not at load: security.ts imports this module.
const worstFirst = () => [...SEVERITIES].reverse();
const rank = (s: Severity) => SEVERITIES.indexOf(s);
const lower = (s: Severity) => s.toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KIND: Record<string, string> = { weekly: "scheduled", monthly: "monthly live-site", manual: "on-demand" };
const day = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" });

/** "1 high, 3 medium", worst first, leaving out severities with none. */
export function severityList(counts: Partial<Record<Severity, number>>): string {
  return worstFirst()
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]} ${lower(s)}`)
    .join(", ");
}

/** One finding in plain words, by what kind of problem it is. */
export function describeFinding(f: Pick<SummaryFinding, "tool" | "message" | "fixedIn">): string {
  if (DEPENDENCY_TOOLS.includes(f.tool)) {
    const pkg = packageOf(f.message);
    const what = pkg ? `${pkg}, a building block the app uses` : "a building block the app uses";
    return `a weakness in ${what}${f.fixedIn ? " (a newer version fixes it)" : ""}`;
  }
  if (f.tool === "gitleaks") return "a password or key that appears in the code; it has to be changed wherever it is used, which the assistant cannot do";
  if (f.tool === "zap") return "a weakness found by testing the live website";
  return "a possible weakness in the app's own code";
}

export function securitySummary({ latest, previous, open }: SummaryInput): string[] {
  const lines: string[] = [];
  const kind = KIND[latest.kind] ?? latest.kind;

  // What the latest scan did.
  const o = latest.outcome;
  if (o) {
    const fresh = o.created + o.reopened;
    const fixed = o.fixed > 0 ? `${fresh > 0 ? ", and" : ". It"} confirmed ${plural(o.fixed, "earlier problem is", "earlier problems are")} fixed` : "";
    if (fresh > 0) {
      const back = o.reopened > 0 ? ` (${o.reopened === fresh ? (fresh === 1 ? "it had" : "they had") : `${o.reopened} had`} been fixed before and came back)` : "";
      const sev = severityList(o.newBySeverity);
      lines.push(`The ${kind} scan on ${day(latest.at)} found ${plural(fresh, "new problem", "new problems")}${sev ? `: ${sev}` : ""}${back}${fixed}.`);
    } else {
      lines.push(`The ${kind} scan on ${day(latest.at)} found nothing new${fixed}.`);
    }
  } else {
    lines.push(`The ${kind} scan on ${day(latest.at)} reported ${plural(latest.total, "problem", "problems")}.`);
  }

  // Better or worse than the scan before.
  if (previous) {
    const was = `${latest.total} in all`;
    if (latest.total < previous.total) lines.push(`It reported ${was}, down from ${previous.total} the scan before.`);
    else if (latest.total > previous.total) lines.push(`It reported ${was}, up from ${previous.total} the scan before.`);
    else lines.push(`It reported ${was}, the same as the scan before.`);
  }

  // What is open now, and the most urgent of it.
  if (open.length === 0) {
    lines.push("Nothing is open.");
  } else {
    const counts: Partial<Record<Severity, number>> = {};
    for (const f of open) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    lines.push(`${plural(open.length, "problem is", "problems are")} open: ${severityList(counts)}.`);
    const urgent = [...open].sort((a, b) => rank(b.severity) - rank(a.severity))[0]!;
    lines.push(`The most urgent (${lower(urgent.severity)}) is ${describeFinding(urgent)}.`);

    // What is being done.
    const fixing = open.filter((f) => f.status === "FIXING").length;
    const waiting = open.filter((f) => f.status === "OPEN" && f.tool !== "gitleaks").length;
    const doing: string[] = [];
    if (fixing > 0) doing.push(`${plural(fixing, "is", "are")} being fixed`);
    if (waiting > 0) doing.push(`${plural(waiting, "is", "are")} waiting for someone to choose: fix it, or accept the risk`);
    if (doing.length > 0) lines.push(`${doing.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()));
  }

  return lines;
}
