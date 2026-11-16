"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { currentScanRun, dismissFindings, fixSelectedFindings, ItActionError, reopenFinding, runAiTriage, startScan, type Responder } from "../domain/it";
import { userActor } from "../domain/shared/actor";
import { errorMessage } from "./shared";

/** Owner and Office: starts the security scan now. The report arrives a few minutes later on its own. */
export async function scanNowAction(): Promise<{ error: string | null }> {
  await requireRole(Access.IT_MANAGE);
  const r = await startScan();
  return r.started ? { error: null } : { error: r.reason };
}

/** Owner and Office: have the AI give its opinion of the findings nobody has judged yet. Waits for it (up to a minute or two). */
export async function triageFindingsAction(): Promise<{ error: string | null; judged?: number }> {
  await requireRole(Access.IT_MANAGE);
  const r = await runAiTriage();
  return r.ok ? { error: null, judged: r.judged } : { error: r.reason };
}

type AuthedUser = Awaited<ReturnType<typeof requireRole>>;
const responder = (user: AuthedUser): Responder => ({ actor: userActor(user), userId: user.id, email: user.email ?? null, name: user.name ?? null, roles: user.roles });

async function decide(run: (who: Responder) => Promise<string | void>): Promise<{ error: string | null; note?: string }> {
  const user = await requireRole(Access.IT_MANAGE);
  try {
    // The previous scan's findings are history once a new scan is running; the new report decides what is open.
    if (await currentScanRun()) throw new ItActionError("A new scan is running. The earlier results are history now; act on the new ones when it finishes.");
    const note = await run(responder(user));
    return { error: null, ...(note ? { note } : {}) };
  } catch (err) {
    return { error: err instanceof ItActionError ? err.message : errorMessage(err) };
  }
}

/** Owner and Office: have the assistant fix everything ticked, in one change. */
export async function fixSelectedAction(ids: string[]) {
  return decide(async (who) => {
    const r = await fixSelectedFindings(Array.isArray(ids) ? ids.map(String) : [], who);
    if (!r.opened) throw new ItActionError(r.reason);
    return r.skipped.length ? `${r.requestNumber} opened. ${r.skipped.length} of the ticked ${r.skipped.length === 1 ? "finding was" : "findings were"} left out: ${[...new Set(r.skipped.map((x) => x.reason))].join("; ")}.` : `${r.requestNumber} opened.`;
  });
}

/** Owner and Office: everything ticked is not worth fixing. Accepting a risk needs one reason, which covers them all. */
export async function dismissSelectedAction(ids: string[], status: string, reason: string) {
  return decide(async (who) => {
    const r = await dismissFindings({ ids: Array.isArray(ids) ? ids.map(String) : [], status: String(status), reason: String(reason ?? "") }, who);
    return r.failed.length ? `${r.done} saved. ${r.failed.length} could not be: ${[...new Set(r.failed.map((f) => f.reason))].join("; ")}.` : undefined;
  });
}

/** Owner and Office: undo a dismissal. */
export async function reopenFindingAction(id: string) {
  return decide((who) => reopenFinding(String(id), who));
}
