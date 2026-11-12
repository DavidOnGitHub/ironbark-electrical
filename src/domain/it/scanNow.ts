/**
 * "Scan now": starts the security scan workflow on GitHub instead of waiting for Monday. The workflow does the work and
 * posts its report to /api/it/scan like any scheduled run; this only asks GitHub to start it.
 * Needs IT_SCAN_REPO (owner/name) and IT_SCAN_DISPATCH_TOKEN (a fine-grained token with Actions: read and write on that
 * one repository). Without both the button is not shown.
 */
import { appDb } from "../../db/app";

export const SCAN_WORKFLOW_FILE = "security-weekly.yml";
/** A scan that finished this recently is shown instead of starting another. */
export const SCAN_COOLDOWN_MS = 10 * 60_000;

type Env = Record<string, string | undefined>;

export const scanNowAvailable = (env: Env = process.env): boolean => Boolean(env.IT_SCAN_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.IT_SCAN_REPO) && env.IT_SCAN_DISPATCH_TOKEN);

export type ScanNowResult = { started: true } | { started: false; reason: string };

/** Asks GitHub to run the workflow on the default branch. Never throws: a refusal comes back as a plain reason. */
export async function startScan(env: Env = process.env, opts: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<ScanNowResult> {
  if (!scanNowAvailable(env)) return { started: false, reason: "Starting a scan from here is not set up." };
  const now = opts.now ?? new Date();
  const last = await appDb.securityScan.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  if (last && now.getTime() - last.receivedAt.getTime() < SCAN_COOLDOWN_MS) return { started: false, reason: "A scan finished a few minutes ago. Its results are below." };

  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://api.github.com/repos/${env.IT_SCAN_REPO}/actions/workflows/${SCAN_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${env.IT_SCAN_DISPATCH_TOKEN}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" },
      body: JSON.stringify({ ref: env.IT_SCAN_REF || "main" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return { started: true };
    if (res.status === 401 || res.status === 403) return { started: false, reason: "GitHub would not allow it. The access token may have expired or lacks permission to run workflows." };
    if (res.status === 404) return { started: false, reason: "GitHub could not find the scan workflow on the main branch." };
    return { started: false, reason: `GitHub answered ${res.status}. Try again in a minute.` };
  } catch {
    return { started: false, reason: "Could not reach GitHub. Try again in a minute." };
  }
}

export interface ScanRun {
  /** When GitHub started (or queued) the run. */
  since: Date;
  /** The run's page on GitHub, for anyone who wants to watch it. */
  url: string;
}

/**
 * The scan that is running right now, if any, asked of GitHub (so it also sees a scan started from the Actions tab or by
 * the schedule). Null when none is running, or when GitHub could not be asked: a missing answer must never hide the page.
 */
export async function currentScanRun(env: Env = process.env, opts: { fetchImpl?: typeof fetch } = {}): Promise<ScanRun | null> {
  if (!scanNowAvailable(env)) return null;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://api.github.com/repos/${env.IT_SCAN_REPO}/actions/workflows/${SCAN_WORKFLOW_FILE}/runs?per_page=5`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${env.IT_SCAN_DISPATCH_TOKEN}`, "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { workflow_runs?: { status?: string; created_at?: string; html_url?: string }[] };
    const live = (body.workflow_runs ?? []).find((r) => r.status === "queued" || r.status === "in_progress" || r.status === "waiting" || r.status === "pending" || r.status === "requested");
    if (!live?.created_at || !live.html_url) return null;
    const since = new Date(live.created_at);
    return Number.isNaN(since.getTime()) || !live.html_url.startsWith("https://github.com/") ? null : { since, url: live.html_url };
  } catch {
    return null;
  }
}
