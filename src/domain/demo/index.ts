/**
 * The "break something on purpose" switch, for showing the IT assistant's error loop live: while it is on, one
 * known, easily fixed bug is active (see quotes/validity.ts). It only works where IT_DEMO_BREAK=on, which is set on
 * staging and nowhere else, so a copy of the flag in a production database does nothing. Turning it on or off is
 * recorded on the timeline.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";

export const DEMO_BREAK_KEY = "demo-break";

export class DemoBreakError extends Error {}

/** Whether this environment allows the switch at all. */
export const demoBreakAvailable = (env: Record<string, string | undefined> = process.env) => env.IT_DEMO_BREAK === "on";

/** True only when the environment allows it AND the switch is on. */
export async function isDemoBreakOn(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!demoBreakAvailable(env)) return false;
  const row = await appDb.appFlag.findUnique({ where: { key: DEMO_BREAK_KEY } });
  return row?.enabled === true;
}

export async function setDemoBreak(on: boolean, actor: Actor, env: Record<string, string | undefined> = process.env): Promise<{ enabled: boolean; changed: boolean }> {
  if (!demoBreakAvailable(env)) throw new DemoBreakError("The demo bug is not available in this environment.");
  return appDb.$transaction(async (tx) => {
    const prev = await tx.appFlag.findUnique({ where: { key: DEMO_BREAK_KEY } });
    if ((prev?.enabled ?? false) === on) return { enabled: on, changed: false };
    await tx.appFlag.upsert({ where: { key: DEMO_BREAK_KEY }, create: { key: DEMO_BREAK_KEY, enabled: on, updatedBy: actor.label }, update: { enabled: on, updatedBy: actor.label } });
    await recordActivity(tx, { actor, entityType: "appFlag", entityId: DEMO_BREAK_KEY, kind: "UPDATED", summary: on ? "Demo bug switched ON (the Quotes list will fail on a sent quote)" : "Demo bug switched off" });
    return { enabled: on, changed: true };
  });
}
