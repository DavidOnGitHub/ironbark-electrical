import { describe, expect, it, vi } from "vitest";
import { reconcileRuns, type ReconcileDeps, type TemporalRunState } from "../src/automation/reconcile";

const deps = (states: Record<string, TemporalRunState>, over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({
  findRunning: async () => Object.keys(states).map((id) => ({ id })),
  stateOf: async (id) => states[id],
  close: vi.fn(async () => {}),
  dropStaleTasks: async () => 0,
  ...over,
});

describe("reconcileRuns", () => {
  it("closes runs whose workflow is gone, with the status Temporal gave, and leaves live ones alone", async () => {
    const d = deps({ live: "running", lost: "gone", done: "completed", stopped: "cancelled" });
    const r = await reconcileRuns(d);
    expect(r.closedRuns).toBe(3);
    expect(vi.mocked(d.close).mock.calls).toEqual([["lost", "FAILED"], ["done", "COMPLETED"], ["stopped", "CANCELLED"]]);
  });
  it("touches nothing it could not ask Temporal about", async () => {
    const d = deps({ a: "unknown" });
    expect(await reconcileRuns(d)).toEqual({ closedRuns: 0, removedTasks: 0, skipped: 1 });
    expect(d.close).not.toHaveBeenCalled();
  });
  it("reports the stale tasks it removed", async () => {
    expect((await reconcileRuns(deps({}, { dropStaleTasks: async () => 3 }))).removedTasks).toBe(3);
  });
  it("never throws", async () => {
    const r = await reconcileRuns(deps({}, { findRunning: async () => { throw new Error("db down"); } }));
    expect(r).toEqual({ closedRuns: 0, removedTasks: 0, skipped: 0 });
  });
});
