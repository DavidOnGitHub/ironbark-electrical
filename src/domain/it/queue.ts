/**
 * Moves the queue along: when a lane is free, opens the fix that has waited longest or matters most. Runs after every
 * scan and once a minute in the worker, so a fix starts soon after the one in front of it has merged or stopped.
 */
import { appDb } from "../../db/app";
import { type AiBuilderClient, defaultClient } from "./index";
import { MAX_FIX_ATTEMPTS, openErrorFix } from "./errors";
import { laneBusy } from "./lane";
import { openNextFindingFix, queuedFindingCount } from "./triage";

/** Errors the classifier called code bugs that are not fixed and have nothing in flight: never tried, or came back after a fix went live. */
async function waitingErrorIds(): Promise<string[]> {
  const candidates = await appDb.errorEvent.findMany({ where: { resolvedAt: null, classification: "code_bug", classConfidence: { not: "low" } }, orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }], take: 100 });
  const out: string[] = [];
  for (const e of candidates) {
    const tried = await appDb.itRequest.findMany({ where: { sourceType: "error", sourceId: e.id }, orderBy: { createdAt: "desc" }, select: { status: true } });
    if (tried.length >= MAX_FIX_ATTEMPTS) continue;
    if (tried.length === 0 || tried[0]!.status === "LIVE") out.push(e.id);
  }
  return out;
}

export interface QueueCounts {
  errors: number;
  findings: number;
}

/** How many automated fixes are waiting for their turn. */
export async function queuedFixCounts(env: Record<string, string | undefined> = process.env): Promise<QueueCounts> {
  const [errors, findings] = await Promise.all([laneBusy("ERROR", env).then((busy) => (busy ? waitingErrorIds().then((ids) => ids.length) : 0)), laneBusy("FINDING", env).then((busy) => (busy ? queuedFindingCount() : 0))]);
  return { errors, findings };
}

/** Opens the next fix in each free lane. Safe to call as often as you like. */
export async function advanceFixQueue(client: AiBuilderClient | null = defaultClient(), env: Record<string, string | undefined> = process.env): Promise<{ errors: number; findings: number }> {
  const result = { errors: 0, findings: 0 };
  if (!client) return result;
  if (!(await laneBusy("ERROR", env))) {
    for (const id of await waitingErrorIds()) {
      const r = await openErrorFix(id, client, env).catch(() => null);
      if (r?.opened) {
        result.errors++;
        break;
      }
      if (r && !r.opened && /^Waiting for /.test(r.reason ?? "")) break;
    }
  }
  if (!(await laneBusy("FINDING", env))) result.findings = (await openNextFindingFix(client, env)).opened ? 1 : 0;
  return result;
}
