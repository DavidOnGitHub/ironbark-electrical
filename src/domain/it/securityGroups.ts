/**
 * The Security tab's list, arranged the way fixes are made: one row per package (or per code finding), saying which fix
 * covers it and where that fix stands. A person reading the tab should never have to guess which request is for which problem.
 */
import { appDb } from "../../db/app";
import { SEVERITIES, type Severity } from "./security";
import { IT_STATUS_LABEL, type ItStatusValue } from "./status";
import { fixability, packageOf } from "./triage";
import { TRIAGE_CONFIDENCES, TRIAGE_VERDICTS, type TriageConfidence, type TriageVerdict } from "./aiTriage";

const DEPENDENCY_TOOLS = ["osv", "pnpm-audit"];
const rank = (s: string) => SEVERITIES.indexOf(s as Severity);

export type FixKind = "merged" | "inProgress" | "failed" | "closed" | "pending" | "manual";

/** Where the fix for one group stands. */
export interface FixState {
  kind: FixKind;
  /** One plain sentence. */
  text: string;
  requestId: string | null;
  requestNumber: string | null;
  prUrl: string | null;
}

/** The AI's opinion of a finding. Advice only: a person still decides. Null until it has looked. */
export interface TriageView {
  verdict: TriageVerdict;
  confidence: TriageConfidence;
  reason: string;
  /** For a duplicate, what it repeats, in words. */
  duplicateOf: string | null;
}

export interface FindingRow {
  id: string;
  severity: Severity;
  message: string;
  tool: string;
  file: string | null;
  seenCount: number;
  fixedIn: string | null;
  triage: TriageView | null;
}

/** Noise the AI is sure enough about to offer for clearing (a hesitant noise call is stored as "not sure" already). */
export const isClearNoise = (t: TriageView | null): boolean => t?.verdict === "noise" && (t.confidence === "high" || t.confidence === "medium");

export interface FindingGroup {
  key: string;
  /** The package, or the finding's own text for a code finding. */
  title: string;
  severity: Severity;
  fix: FixState;
  /** A person may tick it: nothing is being done about it right now. */
  selectable: boolean;
  /** The assistant can fix it (a leaked secret can only be accepted once rotated). */
  fixable: boolean;
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

function triageOf(f: { triageVerdict: string | null; triageConfidence: string | null; triageReason: string | null; triageDuplicateOf: string | null }, titleById: Map<string, string>): TriageView | null {
  if (!f.triageVerdict || !(TRIAGE_VERDICTS as readonly string[]).includes(f.triageVerdict)) return null;
  const confidence = (TRIAGE_CONFIDENCES as readonly string[]).includes(f.triageConfidence ?? "") ? (f.triageConfidence as TriageConfidence) : "low";
  return { verdict: f.triageVerdict as TriageVerdict, confidence, reason: f.triageReason ?? "", duplicateOf: f.triageDuplicateOf ? (titleById.get(f.triageDuplicateOf)?.slice(0, 120) ?? null) : null };
}

const STATE_OF: Record<string, FixKind> = { BUILD_FAILED: "failed", FAILED: "failed", DEPLOY_FAILED: "failed", MERGED: "merged", LIVE: "merged", CLOSED: "closed" };

export async function securityGroups(maxGroups = 60): Promise<{ groups: FindingGroup[]; moreGroups: number; recentlyFixed: FixedRow[]; untriaged: number }> {
  const [open, fixed] = await Promise.all([
    appDb.finding.findMany({ where: { status: { in: ["OPEN", "FIXING"] } } }),
    appDb.finding.findMany({ where: { status: "FIXED" }, orderBy: { fixedAt: "desc" }, take: 15 }),
  ]);
  const ids = [...new Set([...open, ...fixed].map((f) => f.itRequestId).filter((x): x is string => Boolean(x)))];
  const requests = ids.length ? await appDb.itRequest.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, status: true, prUrl: true } }) : [];
  const byId = new Map(requests.map((r) => [r.id, r]));

  const titleById = new Map(open.map((f) => [f.id, DEPENDENCY_TOOLS.includes(f.tool) ? (packageOf(f.message) ?? f.message) : f.message]));
  // One row per package for dependency findings; everything else stands alone.
  const buckets = new Map<string, typeof open>();
  for (const f of open) {
    const pkg = DEPENDENCY_TOOLS.includes(f.tool) ? packageOf(f.message) : null;
    const key = pkg ? `pkg:${pkg}` : `finding:${f.id}`;
    buckets.set(key, [...(buckets.get(key) ?? []), f]);
  }

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
      const fx = fixability(sorted[0]!);
      fix = fx.fixable
        ? { kind: "pending", text: "Not fixed yet. Tick it to have it fixed, or to accept the risk.", requestId: null, requestNumber: null, prUrl: null }
        : { kind: "manual", text: `${fx.reason}. Tick it to accept the risk once it has been dealt with.`, requestId: null, requestNumber: null, prUrl: null };
    }
    const title = key.startsWith("pkg:") ? key.slice(4) : sorted[0]!.message;
    return {
      key, title, severity: sorted[0]!.severity as Severity, fix,
      selectable: fix.kind !== "inProgress" && fix.kind !== "merged",
      fixable: fix.kind !== "manual",
      findings: sorted.map((f) => ({ id: f.id, severity: f.severity as Severity, message: f.message, tool: f.tool, file: f.file, seenCount: f.seenCount, fixedIn: f.fixedIn, triage: triageOf(f, titleById) })),
    };
  });
  // Within a severity, what the AI judged to be noise goes last, so the findings worth reading come first.
  const noisy = (g: FindingGroup) => (g.findings.every((f) => isClearNoise(f.triage)) ? 1 : 0);
  groups.sort((a, b) => rank(b.severity) - rank(a.severity) || noisy(a) - noisy(b) || b.findings.length - a.findings.length || a.title.localeCompare(b.title));

  const recentlyFixed: FixedRow[] = fixed.map((f) => {
    const req = f.itRequestId ? byId.get(f.itRequestId) : undefined;
    return { id: f.id, severity: f.severity as Severity, message: f.message, tool: f.tool, at: f.fixedAt ?? f.updatedAt, requestId: req?.id ?? null, requestNumber: req?.number ?? null };
  });
  return { groups: groups.slice(0, maxGroups), moreGroups: Math.max(0, groups.length - maxGroups), recentlyFixed, untriaged: open.filter((f) => f.status === "OPEN" && !f.triagedAt).length };
}
