/**
 * The Security tab's list, arranged the way fixes are made: one row per package (or per code finding), saying which fix
 * covers it and where that fix stands. A person reading the tab should never have to guess which request is for which problem.
 */
import { appDb } from "../../db/app";
import { SEVERITIES, type Severity } from "./security";
import { IT_STATUS_LABEL, type ItStatusValue } from "./status";
import { decideFinding, packageOf, securityFixEnabled } from "./triage";

const DEPENDENCY_TOOLS = ["osv", "pnpm-audit"];
const rank = (s: string) => SEVERITIES.indexOf(s as Severity);

export type FixKind = "merged" | "inProgress" | "failed" | "closed" | "queued" | "manual";

/** Where the fix for one group stands. */
export interface FixState {
  kind: FixKind;
  /** One plain sentence. */
  text: string;
  requestId: string | null;
  requestNumber: string | null;
  prUrl: string | null;
}

export interface FindingRow {
  id: string;
  severity: Severity;
  message: string;
  tool: string;
  file: string | null;
  seenCount: number;
  fixedIn: string | null;
}

export interface FindingGroup {
  key: string;
  /** The package, or the finding's own text for a code finding. */
  title: string;
  severity: Severity;
  fix: FixState;
  findings: FindingRow[];
}

export interface FixedRow {
  id: string;
  severity: Severity;
  message: string;
  tool: string;
  at: Date;
  /** The fix that cleared it, or null when the scan simply stopped reporting it. */
  requestId: string | null;
  requestNumber: string | null;
}

const STATE_OF: Record<string, FixKind> = { BUILD_FAILED: "failed", FAILED: "failed", DEPLOY_FAILED: "failed", MERGED: "merged", LIVE: "merged", CLOSED: "closed" };

export async function securityGroups(maxGroups = 60): Promise<{ groups: FindingGroup[]; moreGroups: number; recentlyFixed: FixedRow[] }> {
  const [open, fixed] = await Promise.all([
    appDb.finding.findMany({ where: { status: { in: ["OPEN", "FIXING"] } } }),
    appDb.finding.findMany({ where: { status: "FIXED" }, orderBy: { fixedAt: "desc" }, take: 15 }),
  ]);
  const ids = [...new Set([...open, ...fixed].map((f) => f.itRequestId).filter((x): x is string => Boolean(x)))];
  const requests = ids.length ? await appDb.itRequest.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, status: true, prUrl: true } }) : [];
  const byId = new Map(requests.map((r) => [r.id, r]));

  // One row per package for dependency findings; everything else stands alone.
  const buckets = new Map<string, typeof open>();
  for (const f of open) {
    const pkg = DEPENDENCY_TOOLS.includes(f.tool) ? packageOf(f.message) : null;
    const key = pkg ? `pkg:${pkg}` : `finding:${f.id}`;
    buckets.set(key, [...(buckets.get(key) ?? []), f]);
  }

  const autoFix = securityFixEnabled();
  const groups: FindingGroup[] = [...buckets.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => rank(b.severity) - rank(a.severity) || b.seenCount - a.seenCount);
    const req = sorted.map((f) => (f.itRequestId ? byId.get(f.itRequestId) : undefined)).find(Boolean);
    let fix: FixState;
    if (req) {
      const kind: FixKind = STATE_OF[req.status] ?? "inProgress";
      const text =
        kind === "merged" ? `Fixed by ${req.number} and merged. This clears at the next scan of the main branch.`
        : kind === "failed" ? `${req.number} could not make the fix. It can be tried again.`
        : kind === "closed" ? `${req.number} was closed without a change.`
        : `Being fixed in ${req.number} (${IT_STATUS_LABEL[req.status as ItStatusValue].toLowerCase()}).`;
      fix = { kind, text, requestId: req.id, requestNumber: req.number, prUrl: req.prUrl };
    } else {
      const decision = decideFinding(sorted[0]!);
      fix = !autoFix && decision.action === "fix"
        ? { kind: "manual", text: "Automatic security fixes are switched off.", requestId: null, requestNumber: null, prUrl: null }
        : decision.action === "fix"
          ? { kind: "queued", text: "Waiting in line for a fix. They are made one at a time.", requestId: null, requestNumber: null, prUrl: null }
          : { kind: "manual", text: `Not fixed automatically. ${decision.reason}.`, requestId: null, requestNumber: null, prUrl: null };
    }
    const title = key.startsWith("pkg:") ? key.slice(4) : sorted[0]!.message;
    return {
      key, title, severity: sorted[0]!.severity as Severity, fix,
      findings: sorted.map((f) => ({ id: f.id, severity: f.severity as Severity, message: f.message, tool: f.tool, file: f.file, seenCount: f.seenCount, fixedIn: f.fixedIn })),
    };
  });
  groups.sort((a, b) => rank(b.severity) - rank(a.severity) || b.findings.length - a.findings.length || a.title.localeCompare(b.title));

  const recentlyFixed: FixedRow[] = fixed.map((f) => {
    const req = f.itRequestId ? byId.get(f.itRequestId) : undefined;
    return { id: f.id, severity: f.severity as Severity, message: f.message, tool: f.tool, at: f.fixedAt ?? f.updatedAt, requestId: req?.id ?? null, requestNumber: req?.number ?? null };
  });
  return { groups: groups.slice(0, maxGroups), moreGroups: Math.max(0, groups.length - maxGroups), recentlyFixed };
}
