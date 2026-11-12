"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { dismissFinding, ItActionError, reopenFinding, startScan, type Responder } from "../domain/it";
import { userActor } from "../domain/shared/actor";
import { errorMessage } from "./shared";

/** Owner and Office: starts the security scan now. The report arrives a few minutes later on its own. */
export async function scanNowAction(): Promise<{ error: string | null }> {
  await requireRole(Access.IT_MANAGE);
  const r = await startScan();
  return r.started ? { error: null } : { error: r.reason };
}

type AuthedUser = Awaited<ReturnType<typeof requireRole>>;
const responder = (user: AuthedUser): Responder => ({ actor: userActor(user), userId: user.id, email: user.email ?? null, name: user.name ?? null, roles: user.roles });

async function decide(run: (who: Responder) => Promise<void>): Promise<{ error: string | null }> {
  const user = await requireRole(Access.IT_MANAGE);
  try {
    await run(responder(user));
    return { error: null };
  } catch (err) {
    return { error: err instanceof ItActionError ? err.message : errorMessage(err) };
  }
}

/** Owner and Office: the finding is not worth fixing. Accepting a risk needs a reason. */
export async function dismissFindingAction(id: string, status: string, reason: string) {
  return decide((who) => dismissFinding({ id: String(id), status: String(status), reason: String(reason ?? "") }, who));
}

/** Owner and Office: undo a dismissal. */
export async function reopenFindingAction(id: string) {
  return decide((who) => reopenFinding(String(id), who));
}
