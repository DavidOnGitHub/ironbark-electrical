/**
 * Security scans: the scheduled jobs in CI post one normalised report per run; this turns it into `Finding` rows.
 * A finding is identified by its fingerprint, so a repeat updates the row rather than adding one, a finding that
 * stops being reported is marked FIXED, and one that comes back is reopened. Nothing here talks to AI Builder -
 * triage decides what to do with a finding.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import { IN_FLIGHT } from "./lane";
import type { Actor } from "../shared/actor";

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Finding text comes from scanners and the AI reviewer, so it is bounded and later handed to a model as data only. */
export const ScanFindingSchema = z.object({
  tool: z.string().trim().min(1).max(40),
  ruleId: z.string().trim().min(1).max(200),
  severity: z.enum(SEVERITIES),
  file: z.string().trim().max(500).nullish(),
  line: z.number().int().nonnegative().nullish(),
  message: z.string().trim().min(1).max(2000),
  /** A plain version number only, because it is handed to the assistant as the version to install. */
  fixedIn: z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(60).nullish(),
  /** Stable across runs: must not contain line numbers or anything else that drifts. */
  fingerprint: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_.-]+$/),
  source: z.enum(["scan", "ai-review"]).default("scan"),
});
export type ScanFinding = z.infer<typeof ScanFindingSchema>;

export const ScanReportSchema = z.object({
  /** Unique per run. Doubles as the replay nonce: a scan id is accepted once. */
  scanId: z.string().trim().min(1).max(100),
  kind: z.enum(["weekly", "monthly", "manual"]),
  commit: z.string().trim().max(64).nullish(),
  /** The tools that ran. Only these can mark their own earlier findings fixed, so a tool that crashed fixes nothing. */
  tools: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  findings: z.array(ScanFindingSchema).max(5000),
});
export type ScanReport = z.infer<typeof ScanReportSchema>;

export interface IngestResult {
  duplicate: boolean;
  created: number;
  updated: number;
  reopened: number;
  fixed: number;
  total: number;
}

const SIGNATURE_WINDOW_MS = 5 * 60_000;

/** The signature covers the timestamp and the raw body, so neither can be swapped without the secret. */
export function signScan(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Checks the HMAC and the timestamp window. Replays inside the window are stopped by the unique scan id on ingest. */
export function verifyScanSignature(opts: { secret: string; timestamp: string | null; signature: string | null; body: string; now?: number }): { ok: true } | { ok: false; reason: string } {
  const { secret, timestamp, signature, body } = opts;
  if (!timestamp || !signature) return { ok: false, reason: "Missing signature headers." };
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "Bad timestamp." };
  if (Math.abs((opts.now ?? Date.now()) - sent * 1000) > SIGNATURE_WINDOW_MS) return { ok: false, reason: "Timestamp outside the allowed window." };
  const expected = Buffer.from(signScan(secret, timestamp, body), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return { ok: false, reason: "Bad signature." };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "Bad signature." };
  return { ok: true };
}

const rank = (s: Severity) => SEVERITIES.indexOf(s);

/** One finding as an older scan reported it. Read only: history is never acted on. */
export interface HistoricFinding {
  severity: Severity;
  tool: string;
  message: string;
  file: string | null;
  fixedIn: string | null;
}
/** The most findings kept per scan; the scan's own total still counts all of them. */
export const HISTORY_FINDINGS_KEPT = 500;

/** Applies one report. Idempotent per scan id: a second delivery changes nothing. */
export async function ingestScan(input: unknown, actor: Actor = { type: "SYSTEM", label: "Security scan" }): Promise<IngestResult> {
  const report = ScanReportSchema.parse(input);
  // The same fingerprint twice in one report is one finding, at its highest severity.
  const unique = new Map<string, ScanFinding>();
  for (const f of report.findings) {
    const seen = unique.get(f.fingerprint);
    if (!seen || rank(f.severity) > rank(seen.severity)) unique.set(f.fingerprint, f);
  }
  const findings = [...unique.values()];
  const now = new Date();

  return appDb.$transaction(async (tx) => {
    if (await tx.securityScan.findUnique({ where: { id: report.scanId } })) {
      return { duplicate: true, created: 0, updated: 0, reopened: 0, fixed: 0, total: findings.length };
    }
    const bySeverity: Record<string, number> = {};
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    const snapshot: HistoricFinding[] = [...findings]
      .sort((a, b) => rank(b.severity) - rank(a.severity))
      .slice(0, HISTORY_FINDINGS_KEPT)
      .map((f) => ({ severity: f.severity, tool: f.tool, message: f.message.slice(0, 400), file: f.file ?? null, fixedIn: f.fixedIn ?? null }));
    await tx.securityScan.create({
      data: { id: report.scanId, kind: report.kind, tools: report.tools, commit: report.commit ?? null, total: findings.length, bySeverity, findings: snapshot as unknown as Prisma.InputJsonValue },
    });

    const existing = await tx.finding.findMany({ where: { fingerprint: { in: findings.map((f) => f.fingerprint) } } });
    const byPrint = new Map(existing.map((e) => [e.fingerprint, e]));
    let created = 0;
    let updated = 0;
    let reopened = 0;

    for (const f of findings) {
      const prev = byPrint.get(f.fingerprint);
      if (!prev) {
        const row = await tx.finding.create({
          data: { fingerprint: f.fingerprint, tool: f.tool, ruleId: f.ruleId, severity: f.severity, file: f.file ?? null, line: f.line ?? null, message: f.message, fixedIn: f.fixedIn ?? null, source: f.source, lastScanId: report.scanId, firstScanId: report.scanId, firstSeenAt: now, lastSeenAt: now },
        });
        await recordActivity(tx, { actor, entityType: "finding", entityId: row.id, kind: "CREATED", summary: `${f.severity} finding from ${f.tool}: ${f.message.slice(0, 120)}` });
        created++;
        continue;
      }
      const wasFixed = prev.status === "FIXED";
      // Accepted risks and false positives stay as a person decided; FIXING stays until the change lands.
      const data: Prisma.FindingUpdateInput = {
        severity: f.severity, message: f.message, fixedIn: f.fixedIn ?? null, file: f.file ?? null, line: f.line ?? null,
        lastScanId: report.scanId, lastSeenAt: now, seenCount: { increment: 1 },
        ...(wasFixed ? { status: "OPEN", fixedAt: null } : {}),
      };
      await tx.finding.update({ where: { id: prev.id }, data });
      if (wasFixed) {
        await recordActivity(tx, { actor, entityType: "finding", entityId: prev.id, kind: "REOPENED", summary: `Finding came back: ${f.message.slice(0, 120)}` });
        reopened++;
      } else updated++;
    }

    // Anything these tools reported before and did not report now has gone away.
    const gone = await tx.finding.findMany({
      where: { tool: { in: report.tools }, source: "scan", status: { in: ["OPEN", "FIXING"] }, lastScanId: { not: report.scanId } },
      select: { id: true, message: true },
    });
    for (const g of gone) {
      await tx.finding.update({ where: { id: g.id }, data: { status: "FIXED", fixedAt: now } });
      await recordActivity(tx, { actor, entityType: "finding", entityId: g.id, kind: "FIXED", summary: `No longer reported: ${g.message.slice(0, 120)}` });
    }
    return { duplicate: false, created, updated, reopened, fixed: gone.length, total: findings.length };
  });
}

export interface SecurityReport {
  lastScanAt: Date | null;
  lastScanKind: string | null;
  /** Open findings (open or being fixed) by severity, worst first. */
  openBySeverity: { severity: Severity; count: number }[];
  openTotal: number;
  /** The last few scans, oldest first, for the trend. */
  trend: { id: string; at: Date; kind: string; total: number }[];
  /** Earlier scans, newest first, with what each reported. History only: nothing in it can be acted on. */
  history: { id: string; at: Date; kind: string; total: number; findings: HistoricFinding[] | null }[];
  /** The worst open findings. */
  top: { id: string; hasFix: boolean; fixFailed: boolean; severity: Severity; tool: string; message: string; file: string | null; status: string; seenCount: number; itRequestNumber: string | null }[];
}

/** What the Security tab shows: the state of things now and whether it is getting better. */
export async function securityReport(topN = 25): Promise<SecurityReport> {
  const [scans, open] = await Promise.all([
    appDb.securityScan.findMany({ orderBy: { receivedAt: "desc" }, take: 8 }),
    appDb.finding.findMany({ where: { status: { in: ["OPEN", "FIXING"] } } }),
  ]);
  const count = new Map<Severity, number>();
  for (const f of open) count.set(f.severity as Severity, (count.get(f.severity as Severity) ?? 0) + 1);
  const worstFirst = [...open].sort((a, b) => rank(b.severity as Severity) - rank(a.severity as Severity) || b.seenCount - a.seenCount).slice(0, topN);
  const reqIds = worstFirst.map((f) => f.itRequestId).filter((x): x is string => Boolean(x));
  const reqs = reqIds.length ? await appDb.itRequest.findMany({ where: { id: { in: reqIds } }, select: { id: true, number: true, status: true } }) : [];
  const failedIds = new Set(reqs.filter((r) => r.status === "BUILD_FAILED" || r.status === "FAILED").map((r) => r.id));
  const numberOf = new Map(reqs.map((r) => [r.id, r.number]));
  return {
    lastScanAt: scans[0]?.receivedAt ?? null,
    lastScanKind: scans[0]?.kind ?? null,
    openBySeverity: [...SEVERITIES].reverse().map((severity) => ({ severity, count: count.get(severity) ?? 0 })),
    openTotal: open.length,
    trend: [...scans].reverse().map((s) => ({ id: s.id, at: s.receivedAt, kind: s.kind, total: s.total })),
    history: scans.slice(1).map((s) => ({ id: s.id, at: s.receivedAt, kind: s.kind, total: s.total, findings: Array.isArray(s.findings) ? (s.findings as unknown as HistoricFinding[]).slice(0, 100) : null })),
    top: worstFirst.map((f) => ({ id: f.id, hasFix: Boolean(f.itRequestId) && !failedIds.has(f.itRequestId!), fixFailed: Boolean(f.itRequestId) && failedIds.has(f.itRequestId!), severity: f.severity as Severity, tool: f.tool, message: f.message, file: f.file, status: f.status, seenCount: f.seenCount, itRequestNumber: f.itRequestId ? (numberOf.get(f.itRequestId) ?? null) : null })),
  };
}

export interface SecurityHeadline {
  /** Open findings (open or being fixed). */
  open: number;
  /** Of those, how many have a fix really under way (its request is still going). */
  beingFixed: number;
  /** Of those, how many had a fix that failed and now need a person. */
  failedFix: number;
  bySeverity: Record<Severity, number>;
  /** The worst severity among them, or null when nothing is open. */
  worst: Severity | null;
  lastScanAt: Date | null;
}

/** The few numbers the dashboard banner needs. Cheap: two grouped counts, one lookup of the fixes, and the latest scan. */
export async function securityHeadline(): Promise<SecurityHeadline> {
  const [groups, fixing, last] = await Promise.all([
    appDb.finding.groupBy({ by: ["severity"], where: { status: { in: ["OPEN", "FIXING"] } }, _count: { _all: true } }),
    appDb.finding.findMany({ where: { status: "FIXING" }, select: { itRequestId: true } }),
    appDb.securityScan.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  let open = 0;
  for (const g of groups) {
    bySeverity[g.severity as Severity] += g._count._all;
    open += g._count._all;
  }
  // "Being fixed" is a claim about the request: only count it while that request is still going.
  const ids = fixing.map((f) => f.itRequestId).filter((x): x is string => Boolean(x));
  const requests = ids.length ? await appDb.itRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : [];
  const status = new Map(requests.map((r) => [r.id, r.status]));
  let beingFixed = 0;
  let failedFix = 0;
  for (const f of fixing) {
    const st = f.itRequestId ? status.get(f.itRequestId) : undefined;
    if (st === "BUILD_FAILED" || st === "FAILED") failedFix++;
    else if (st && IN_FLIGHT.includes(st as never)) beingFixed++;
    else if (st === "MERGED" || st === "LIVE") beingFixed++; // merged: waiting for the next scan to confirm
  }
  const worst = [...SEVERITIES].reverse().find((s) => bySeverity[s] > 0) ?? null;
  return { open, beingFixed, failedFix, bySeverity, worst, lastScanAt: last?.receivedAt ?? null };
}
