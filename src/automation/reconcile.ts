/**
 * Keeps the console's runs and tasks in step with Temporal. Temporal drops a closed workflow after its
 * retention window (24h on the local server), and a test run can finish with its approvals still open, so a
 * task can outlive the workflow it belongs to - completing it then fails with "workflow not found for ID".
 * Reconciling removes those tasks and closes any run whose workflow is gone. When Temporal cannot be asked,
 * nothing is touched.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { getTemporalClient } from "@kabosh-digital/workflow-temporal";
import { AUTOMATION_IDS } from "./index";

export type TemporalRunState = "running" | "completed" | "cancelled" | "gone" | "unknown";

/** What reconciling touches - parameters so tests can supply their own. */
export interface ReconcileDeps {
  /** Runs the console shows as RUNNING. */
  findRunning: () => Promise<{ id: string }[]>;
  /** Where Temporal says the run is: "gone" when it has no such workflow (or it ended badly), "unknown" when it could not be asked. */
  stateOf: (instanceId: string) => Promise<TemporalRunState>;
  /** Marks the run finished and removes its open tasks. */
  close: (instanceId: string, status: "COMPLETED" | "CANCELLED" | "FAILED") => Promise<void>;
  /** Removes open tasks on runs that are no longer running; returns how many. */
  dropStaleTasks: () => Promise<number>;
}

export interface ReconcileResult {
  closedRuns: number;
  removedTasks: number;
  skipped: number;
}

const definitionIds = Object.values(AUTOMATION_IDS);

const realDeps: ReconcileDeps = {
  // Not runs started in the last couple of minutes: their row can exist a moment before the workflow does.
  findRunning: () => prisma.workflowInstance.findMany({ where: { definitionId: { in: definitionIds }, status: "RUNNING", startedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } }, select: { id: true } }),
  stateOf: async (instanceId) => {
    try {
      const client = await getTemporalClient();
      const { status } = await client.workflow.getHandle(`instance-${instanceId}`).describe();
      if (status.name === "RUNNING") return "running";
      if (status.name === "COMPLETED") return "completed";
      if (status.name === "CANCELLED") return "cancelled";
      return "gone"; // failed, terminated, timed out: nothing is left to signal
    } catch (err) {
      return err instanceof Error && (err.name === "WorkflowNotFoundError" || /not found/i.test(err.message)) ? "gone" : "unknown";
    }
  },
  close: async (instanceId, status) => {
    await prisma.workflowInstance.update({ where: { id: instanceId }, data: { status, completedAt: new Date() } });
    await prisma.workflowTask.deleteMany({ where: { instanceId, status: "PENDING" } });
  },
  dropStaleTasks: async () => {
    const { count } = await prisma.workflowTask.deleteMany({ where: { status: "PENDING", instance: { definitionId: { in: definitionIds }, status: { not: "RUNNING" } } } });
    return count;
  },
};

/** Safe to run at any time and as often as wanted; never throws. */
export async function reconcileRuns(deps: ReconcileDeps = realDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { closedRuns: 0, removedTasks: 0, skipped: 0 };
  try {
    for (const run of await deps.findRunning()) {
      const state = await deps.stateOf(run.id);
      if (state === "running") continue;
      if (state === "unknown") {
        result.skipped++;
        continue;
      }
      await deps.close(run.id, state === "completed" ? "COMPLETED" : state === "cancelled" ? "CANCELLED" : "FAILED");
      result.closedRuns++;
    }
    result.removedTasks = await deps.dropStaleTasks();
  } catch (err) {
    console.error("[automation] could not reconcile runs:", err instanceof Error ? err.message : err);
  }
  return result;
}

/** Reconciles now, then every `everyMs`; for the worker. The timer never keeps the process alive on its own. */
export function startReconciling(everyMs = 10 * 60 * 1000, deps?: ReconcileDeps): void {
  const tick = async () => {
    const r = await reconcileRuns(deps);
    if (r.closedRuns || r.removedTasks) console.log(`[automation] reconciled: closed ${r.closedRuns} lost run(s), removed ${r.removedTasks} orphaned task(s)`);
  };
  void tick();
  setInterval(tick, everyMs).unref();
}
