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
