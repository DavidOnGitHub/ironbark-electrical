/**
 * Notices workflow runs that failed for a reason no step reported - the engine itself failing, a timeout, a node that
 * could not run - and records them for the IT assistant. A run that failed because a step threw is skipped: the step
 * wrapper (errorHooks.ts) already recorded that error, with its stack, and recording it twice would double the count.
 *
 * Each failed run is looked at once (a cursor remembers how far it got). The first time it runs it starts from now,
 * so old failures are not dug up. When Temporal cannot be asked it stops and tries again next time.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { getTemporalClient } from "@kabosh-digital/workflow-temporal";
import { appDb } from "../db/app";
import { reportError, type CaptureInput } from "../domain/it";
import { AUTOMATION_IDS } from "./index";

export const FAILED_RUNS_CURSOR = "failed-runs";

export interface FailedRun {
  id: string;
  completedAt: Date;
  workflow: string;
  node: string | null;
}

/** Why a run failed, as far as Temporal can tell. */
export type RunCause =
  | { kind: "activity" } // a step threw: already recorded by the step wrapper
  | { kind: "other"; message: string; name?: string; stack?: string }
  | { kind: "gone" } // Temporal has no record of it
  | { kind: "unknown" }; // could not be asked

export interface FailedRunDeps {
  findFailed: (after: Date) => Promise<FailedRun[]>;
  causeOf: (runId: string) => Promise<RunCause>;
  getCursor: () => Promise<Date | null>;
  setCursor: (at: Date) => Promise<void>;
  report: (error: unknown, input: CaptureInput) => Promise<unknown>;
  now: () => Date;
}

export interface FailedRunsResult {
  seen: number;
  reported: number;
  skipped: number;
  /** Stopped early because Temporal could not be asked. */
  paused: boolean;
}

const definitionIds = Object.values(AUTOMATION_IDS);

const realDeps: FailedRunDeps = {
  findFailed: async (after) => {
    const rows = await prisma.workflowInstance.findMany({
      where: { definitionId: { in: definitionIds }, status: "FAILED", mode: "PRODUCTION", completedAt: { gt: after } },
      orderBy: { completedAt: "asc" },
      take: 50,
      select: { id: true, completedAt: true, currentNodeId: true, definition: { select: { name: true } } },
    });
    return rows.filter((r) => r.completedAt).map((r) => ({ id: r.id, completedAt: r.completedAt!, workflow: r.definition.name, node: r.currentNodeId }));
  },
  causeOf: async (runId) => {
    try {
      const client = await getTemporalClient();
      await client.workflow.getHandle(`instance-${runId}`).result();
      return { kind: "gone" }; // it finished fine after all: nothing to report
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { name?: string; message?: string; stack?: string } };
      if (e?.name === "WorkflowNotFoundError" || /not found/i.test(e?.message ?? "")) return { kind: "gone" };
      if (e?.name === "WorkflowFailedError") {
        if (e.cause?.name === "ActivityFailure") return { kind: "activity" };
        return { kind: "other", message: e.cause?.message ?? e.message ?? "The run failed", name: e.cause?.name, stack: e.cause?.stack };
      }
      return { kind: "unknown" };
    }
  },
  getCursor: async () => (await appDb.watchCursor.findUnique({ where: { key: FAILED_RUNS_CURSOR } }))?.at ?? null,
  setCursor: async (at) => {
    await appDb.watchCursor.upsert({ where: { key: FAILED_RUNS_CURSOR }, create: { key: FAILED_RUNS_CURSOR, at }, update: { at } });
  },
  report: reportError,
  now: () => new Date(),
};

/** Safe to run often and from several processes; never throws. */
export async function reportFailedRuns(deps: FailedRunDeps = realDeps): Promise<FailedRunsResult> {
  const result: FailedRunsResult = { seen: 0, reported: 0, skipped: 0, paused: false };
  try {
    let cursor = await deps.getCursor();
    if (!cursor) {
      // First time: start from now, so history is not dug up.
      await deps.setCursor(deps.now());
      return result;
    }
    for (const run of await deps.findFailed(cursor)) {
      result.seen++;
      const cause = await deps.causeOf(run.id);
      // Temporal forgets a closed run after about a day; past that, "could not be asked" will never change.
      const stale = deps.now().getTime() - run.completedAt.getTime() > 24 * 60 * 60_000;
      if (cause.kind === "unknown" && !stale) {
        result.paused = true; // try this run again next time
        break;
      }
      if (cause.kind === "other") {
        const error = Object.assign(new Error(`${cause.message}`), { name: cause.name ?? "WorkflowFailure", stack: cause.stack });
        await deps.report(error, { source: "workflow", route: `workflow:${run.workflow}`, context: { workflow: run.workflow, instanceId: run.id } });
        result.reported++;
      } else result.skipped++;
      cursor = run.completedAt;
      await deps.setCursor(cursor);
    }
  } catch (err) {
    console.error("[it] failed-run check failed", err instanceof Error ? err.message : err);
  }
  return result;
}

/** Checks for newly failed runs every minute, in the worker. The timer never keeps the process alive. */
export function startFailedRunWatch(everyMs = 60_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reportFailedRuns();
      if (r.reported) console.log(`[it] ${r.reported} failed run(s) recorded`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, everyMs).unref();
}
