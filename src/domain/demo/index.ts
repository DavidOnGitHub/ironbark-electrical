/**
 * The "break something on purpose" switches, for showing the IT assistant's error loop live. There is a small pool of
 * known, easily fixed bugs, each behind its own switch, because a fix removes its bug from the code for good: the
 * next run switches on a different one. Every bug only works where IT_DEMO_BREAK=on (staging and nowhere else), so a
 * copy of a flag in a production database does nothing. Each change is recorded on the timeline.
 *
 * To add a bug: write a small pure helper with a `demoBug` argument that throws only when it is true, call it from
 * the page with `await isDemoBugOn(id)`, add it to DEMO_BUGS below, and pin both paths with a test in demo.test.ts.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";

export interface DemoBug {
  id: string;
  title: string;
  /** Where to look to trigger it. */
  page: string;
  /** What the person sees while it is on. */
  effect: string;
}

export const DEMO_BUGS: readonly DemoBug[] = [
  { id: "quote-validity", title: "Quotes: time left on a sent quote", page: "/quotes", effect: "The Quotes list fails while any quote has been sent and is waiting for an answer." },
  { id: "job-schedule", title: "Jobs: length of a visit", page: "/jobs", effect: "The Jobs list fails while any job has not been scheduled yet." },
];

export const demoBugFlagKey = (id: string) => `demo-bug:${id}`;
const findBug = (id: string) => DEMO_BUGS.find((b) => b.id === id);

export class DemoBreakError extends Error {}

/** Whether this environment allows the switches at all. */
export const demoBreakAvailable = (env: Record<string, string | undefined> = process.env) => env.IT_DEMO_BREAK === "on";

/** True only when the environment allows it AND this bug's switch is on. */
export async function isDemoBugOn(id: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!demoBreakAvailable(env) || !findBug(id)) return false;
  const row = await appDb.appFlag.findUnique({ where: { key: demoBugFlagKey(id) } });
  return row?.enabled === true;
}

/** Every bug in the pool with whether it is on (all off where the environment does not allow it). */
export async function listDemoBugs(env: Record<string, string | undefined> = process.env): Promise<(DemoBug & { on: boolean })[]> {
  if (!demoBreakAvailable(env)) return DEMO_BUGS.map((b) => ({ ...b, on: false }));
  const rows = await appDb.appFlag.findMany({ where: { key: { in: DEMO_BUGS.map((b) => demoBugFlagKey(b.id)) } } });
  const on = new Set(rows.filter((r) => r.enabled).map((r) => r.key));
  return DEMO_BUGS.map((b) => ({ ...b, on: on.has(demoBugFlagKey(b.id)) }));
}

export async function setDemoBug(id: string, on: boolean, actor: Actor, env: Record<string, string | undefined> = process.env): Promise<{ enabled: boolean; changed: boolean }> {
  if (!demoBreakAvailable(env)) throw new DemoBreakError("The demo bugs are not available in this environment.");
  const bug = findBug(id);
  if (!bug) throw new DemoBreakError("Unknown demo bug.");
  const key = demoBugFlagKey(id);
  return appDb.$transaction(async (tx) => {
    const prev = await tx.appFlag.findUnique({ where: { key } });
    if ((prev?.enabled ?? false) === on) return { enabled: on, changed: false };
    await tx.appFlag.upsert({ where: { key }, create: { key, enabled: on, updatedBy: actor.label }, update: { enabled: on, updatedBy: actor.label } });
    await recordActivity(tx, { actor, entityType: "appFlag", entityId: key, kind: "UPDATED", summary: on ? `Demo bug switched ON (${bug.title}): ${bug.effect}` : `Demo bug switched off (${bug.title})` });
    return { enabled: on, changed: true };
  });
}

/** Switches every bug off in one go. Returns how many were on. */
export async function resetDemoBugs(actor: Actor, env: Record<string, string | undefined> = process.env): Promise<number> {
  let turnedOff = 0;
  for (const bug of DEMO_BUGS) if ((await setDemoBug(bug.id, false, actor, env)).changed) turnedOff++;
  return turnedOff;
}
