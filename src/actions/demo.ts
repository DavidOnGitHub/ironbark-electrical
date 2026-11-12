"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { resetDemoBugs, setDemoBug } from "../domain/demo";
import { userActor } from "../domain/shared/actor";
import { errorMessage } from "./shared";

/** Owner only, and refused where the environment does not allow it (checked again in the domain, not just here). */
export async function setDemoBugAction(id: string, on: boolean): Promise<{ error: string | null; enabled?: boolean }> {
  const user = await requireRole(Access.IT_DEMO);
  try {
    const r = await setDemoBug(String(id), on === true, userActor(user));
    return { error: null, enabled: r.enabled };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** Owner only: switches every demo bug off. */
export async function resetDemoBugsAction(): Promise<{ error: string | null; turnedOff?: number }> {
  const user = await requireRole(Access.IT_DEMO);
  try {
    return { error: null, turnedOff: await resetDemoBugs(userActor(user)) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
