/**
 * Limits on what the IT assistant may do on its own. Pure rules, so they are easy to test; the places that enforce
 * them (sync, accept, revert guard) call into here.
 *
 *  - Protected paths: changes to migrations, sign-in and permissions, payments, CI and deployment need a developer.
 *    The business cannot accept such a change from Ironbark.
 *  - Cost cap: an automated fix (error or finding) that costs more than the cap is stopped.
 *  - Revert guard: if errors jump after a change goes live, a revert is proposed - never applied by itself.
 */

export interface ProtectedRule {
  label: string;
  test: RegExp;
}

export const PROTECTED_RULES: ProtectedRule[] = [
  { label: "Database migrations and schema", test: /^prisma\/(migrations\/|schema\.prisma$)/ },
  { label: "Sign-in and permissions", test: /^(app\/api\/auth\/|app\/auth\/|app\/connectors\/oauth\/|proxy\.ts$|src\/guard\.ts$|src\/access\.ts$)/ },
  { label: "Payments", test: /^(src\/integrations\/(stripe|payments)[^/]*$|app\/api\/stripe\/|app\/pay\/|scripts\/replayStripePayments\.ts$)/ },
  { label: "CI and workflows", test: /^\.github\// },
  { label: "Assistant settings", test: /^\.ai-builder\// },
  { label: "Deployment and secrets", test: /^(render\.yaml$|\.env[^/]*$)/ },
  { label: "Dependencies", test: /^(package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.npmrc$)/ },
];

const DEPENDENCY_FILE = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;
const SPEC_FILE = /^specs\/[^/]+\.md$/;

/**
 * A dependency fix that came from a security scan: the scanner named the problem, and the assistant is only asked to move a
 * version or add an override. This is the one kind of request that may change the dependency files and still be accepted
 * by the Owner or Office. A bug fix, a requested change or anything a person typed is not.
 */
export const mayChangeDependencies = (req: { kind: string; sourceType?: string | null; intent?: string | null }): boolean =>
  req.kind === "FINDING" && req.sourceType === "finding" && req.intent === "maintenance";

/**
 * The protected files a request touches. For a scan-driven dependency fix, the manifests, the lockfile and its spec are not
 * held for a developer, but only while the change is nothing else: one other file (a source file, `.npmrc`, a workflow)
 * and every protection applies again, dependency files included.
 */
export function protectedFilesFor(files: readonly string[], req: { kind: string; sourceType?: string | null; intent?: string | null }): string[] {
  const normalised = files.map(normalisePath).filter(Boolean);
  if (mayChangeDependencies(req) && normalised.length > 0 && normalised.every((f) => DEPENDENCY_FILE.test(f) || SPEC_FILE.test(f))) return [];
  return protectedFilesIn(files);
}

/** A path as the rules see it: forward slashes, no leading "./" or "/". */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/{2,}/g, "/");
}

/** Which of these files are protected, normalised and de-duplicated. A path that climbs out with ".." is treated as protected. */
export function protectedFilesIn(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of files) {
    const f = normalisePath(raw);
    if (!f) continue;
    if (f.split("/").includes("..") || PROTECTED_RULES.some((r) => r.test.test(f))) out.add(f);
  }
  return [...out].sort();
}

/** Why a file is protected, in words. */
export function protectedReason(file: string): string {
  const f = normalisePath(file);
  return PROTECTED_RULES.find((r) => r.test.test(f))?.label ?? "Outside the project";
}

/** Every file the session pushed, from its events. Merges of the base branch are not the assistant's own changes. */
export function filesPushed(events: ReadonlyArray<Record<string, unknown>>): string[] {
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== "commit_pushed" || e.reason === "base_update" || !Array.isArray(e.files)) continue;
    for (const f of e.files) if (typeof f === "string") out.add(f);
  }
  return [...out];
}

export const DEFAULT_COST_CAP_USD = 5;

/** The most one automated fix may cost. IT_FIX_COST_CAP_USD overrides; anything unusable falls back to the default. */
export function costCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.IT_FIX_COST_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COST_CAP_USD;
}

/** The cap is for fixes the assistant starts itself; a change a person asked for is bounded by AI Builder's own budget. */
export function overCostCap(kind: "FEATURE" | "ERROR" | "FINDING", costUsd: number | null | undefined, env?: Record<string, string | undefined>): boolean {
  return kind !== "FEATURE" && typeof costUsd === "number" && costUsd > costCapUsd(env);
}

// ---- revert guard ----------------------------------------------------------------------------------------------

export const REVERT_WINDOW_MS = 30 * 60_000;
/** Fewer errors than this after a change is noise, however quiet it was before. */
export const SPIKE_MIN_ERRORS = 5;
export const SPIKE_FACTOR = 3;
export const SPIKE_NEW_FINGERPRINTS = 3;

export interface SpikeInput {
  /** Errors in the 30 minutes before the change went live, not counting the one it fixed. */
  before: number;
  /** Errors in the 30 minutes after, not counting the one it fixed. */
  after: number;
  /** Distinct errors first seen after it went live. */
  newErrors: number;
}

export interface SpikeVerdict {
  spike: boolean;
  reason: string;
}

/** A spike is clearly more errors than before (3x and at least 5), or several brand-new kinds of error. */
export function judgeSpike(i: SpikeInput): SpikeVerdict {
  if (i.newErrors >= SPIKE_NEW_FINGERPRINTS) return { spike: true, reason: `${i.newErrors} new kinds of error appeared after the change went live.` };
  if (i.after >= SPIKE_MIN_ERRORS && i.after >= SPIKE_FACTOR * Math.max(i.before, 1)) return { spike: true, reason: `${i.after} errors in the 30 minutes after it went live, against ${i.before} in the 30 minutes before.` };
  return { spike: false, reason: `${i.after} errors after, ${i.before} before, ${i.newErrors} new: within normal range.` };
}
