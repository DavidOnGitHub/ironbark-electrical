/**
 * Scan-driven dependency fixes merge themselves. Nobody in the business can judge a version bump, so asking them to accept
 * one is a question they can only answer by guessing. What stands in for their judgement is the same gate they would have
 * relied on: AI Builder says the change is ready (its checks passed on the exact commit, the preview works), and the change
 * is nothing but dependency files. Anything else stays with a person or a developer.
 *
 * Off with IT_SECURITY_AUTOMERGE=off, after which these wait for Owner or Office to accept, as before.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { AiBuilderClient } from "./aiBuilder";
import { AiBuilderError } from "./aiBuilder";
import { DEPENDENCY_FILE, filesPushed, mayChangeDependencies, protectedFilesFor } from "./guardrails";
import { defaultClient, syncItRequest } from "./index";

export const securityAutoMergeOn = (env: Record<string, string | undefined> = process.env): boolean => env.IT_SECURITY_AUTOMERGE?.trim().toLowerCase() !== "off";

const SYSTEM = { email: "it-assistant@system.local", name: "IT assistant", role: "approver" as const };

/** Accepts every scan-driven dependency fix that is ready and touches only dependency files. Returns how many were merged. */
export async function autoMergeDependencyFixes(client: AiBuilderClient | null = defaultClient(), env: Record<string, string | undefined> = process.env): Promise<number> {
  if (!client || !securityAutoMergeOn(env)) return 0;
  const open = await appDb.itRequest.findMany({ where: { kind: "FINDING", status: "PR_OPEN", needsDeveloper: false, sessionId: { not: null } }, orderBy: { createdAt: "asc" } });
  let merged = 0;
  for (const row of open) {
    if (!mayChangeDependencies(row)) continue;
    try {
      const detail = await client.getSession(row.sessionId!);
      const files = filesPushed(detail.events);
      // Checked here as well as when the request was last synced: it must be a real dependency change, and nothing protected.
      if (protectedFilesFor(files, row).length > 0 || !files.some((f) => DEPENDENCY_FILE.test(f))) continue;
      const acceptance = detail.acceptance;
      if (!acceptance?.ready || !acceptance.sha || acceptance.blockers.length > 0) continue;
      await client.accept(row.sessionId!, acceptance.sha, SYSTEM);
      await appDb.$transaction((tx) => recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "itRequest", entityId: row.id, kind: "UPDATED", summary: `${row.number}: dependency fix passed its checks and was merged automatically` }));
      await syncItRequest(row.id, client);
      merged++;
    } catch (err) {
      // Not ready yet or refused: left as it is, and tried again next time round. Anyone can still accept it by hand.
      if (!(err instanceof AiBuilderError)) console.error(`[it] auto-merge of ${row.number} failed`, err);
    }
  }
  return merged;
}
