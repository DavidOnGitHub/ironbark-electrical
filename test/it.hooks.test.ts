/* eslint-disable @typescript-eslint/no-explicit-any -- loose step context and fake deps in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { withErrorReporting } from "../src/automation/errorHooks";
import { reportFailedRuns, type FailedRun, type FailedRunDeps, type RunCause } from "../src/automation/failedRuns";
import { captureError, resetErrorThrottle, whereLabel } from "../src/domain/it";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("withErrorReporting (steps)", () => {
  const stripeDown = () => Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:443"), { stack: "Error: connect ECONNREFUSED\n    at createPaymentLink (/app/w.js:1:1)" });

  it("records the error, then rethrows the very same error", async () => {
    const boom = stripeDown();
    const wrapped = withErrorReporting("createPaymentLink", async () => {
      throw boom;
    });
    await expect(wrapped({}, {} as any)).rejects.toBe(boom);
    const row = await appDb.errorEvent.findFirstOrThrow();
    expect(row).toMatchObject({ source: "step", route: "step:createPaymentLink", count: 1 });
    expect(row.context).toEqual({ stepKey: "createPaymentLink" });
    expect(row.classification).toBe("external_outage");
  });

  it("passes a result straight through and records nothing", async () => {
    const wrapped = withErrorReporting("ok", async (config: { n: number }) => ({ doubled: config.n * 2 }));
    expect(await wrapped({ n: 4 }, {} as any)).toEqual({ doubled: 8 });
    expect(await appDb.errorEvent.count()).toBe(0);
  });

  it("does not record failures of an editor test run", async () => {
    const wrapped = withErrorReporting("t", async () => {
      throw new Error("made-up data failed");
    });
    await expect(wrapped({}, { [TEST_MODE_CONTEXT_KEY]: true } as any)).rejects.toThrow("made-up data failed");
    expect(await appDb.errorEvent.count()).toBe(0);
  });

  it("lets the real error through even if recording is impossible", async () => {
    const real = new TypeError("Cannot read properties of null (reading 'x')");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = withErrorReporting("t", async () => {
      throw real;
    });
    // A hostile error object whose fields cannot be read: capture swallows it, the original still comes out.
    const hostile = { get message(): string { throw new Error("nope"); } };
    const wrapped2 = withErrorReporting("t2", async () => {
      throw hostile;
    });
    await expect(wrapped({}, {} as any)).rejects.toBe(real);
    await expect(wrapped2({}, {} as any)).rejects.toBe(hostile);
    spy.mockRestore();
  });

  it("counts repeated failures of the same step as one error", async () => {
    const wrapped = withErrorReporting("sendEmail", async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'to')");
    });
    for (let i = 0; i < 3; i++) {
      resetErrorThrottle();
      await wrapped({}, {} as any).catch(() => undefined);
    }
    const rows = await appDb.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
  });

  it("is described as a background task, not a page", async () => {
    await withErrorReporting("x", async () => { throw new TypeError("Cannot read properties of null (reading 'a')"); })({}, {} as any).catch(() => undefined);
    const row = await appDb.errorEvent.findFirstOrThrow();
    expect(whereLabel(row.route, row.source)).toBe("A background task");
  });
});

describe("reportFailedRuns", () => {
  const T0 = new Date("2026-11-07T10:00:00Z");
  const run = (id: string, m: number, workflow = "Quote chase"): FailedRun => ({ id, completedAt: new Date(T0.getTime() + m * 60_000), workflow, node: "n1" });

  function deps(runs: FailedRun[], causes: Record<string, RunCause>, over: Partial<FailedRunDeps> = {}) {
    let cursor: Date | null = T0;
    const reported: any[] = [];
    const d: FailedRunDeps = {
      findFailed: async (after) => runs.filter((r) => r.completedAt > after),
      causeOf: async (id) => causes[id] ?? { kind: "unknown" },
      getCursor: async () => cursor,
      setCursor: async (at) => {
        cursor = at;
      },
      report: async (error, input) => {
        reported.push({ error, input });
      },
      now: () => new Date(T0.getTime() + 60 * 60_000),
      ...over,
    };
    return { d, reported, cursor: () => cursor };
  }

  it("starts from now the first time, without digging up old failures", async () => {
    const t = deps([run("old", -500)], {}, { getCursor: async () => null });
    const set = vi.fn();
    expect(await reportFailedRuns({ ...t.d, getCursor: async () => null, setCursor: set })).toMatchObject({ seen: 0, reported: 0 });
    expect(set).toHaveBeenCalledWith(new Date(T0.getTime() + 60 * 60_000));
    expect(t.reported).toHaveLength(0);
  });

  it("reports a run that failed for a reason no step recorded", async () => {
    const t = deps([run("r1", 5)], { r1: { kind: "other", message: "Workflow execution timed out", name: "TimeoutFailure" } });
    expect(await reportFailedRuns(t.d)).toEqual({ seen: 1, reported: 1, skipped: 0, paused: false });
    expect(t.reported[0].input).toMatchObject({ source: "workflow", route: "workflow:Quote chase", context: { workflow: "Quote chase" } });
    expect(t.reported[0].error).toMatchObject({ name: "TimeoutFailure", message: "Workflow execution timed out" });
    expect(t.cursor()).toEqual(run("r1", 5).completedAt);
  });

  it("skips a run that failed because a step threw (the step already recorded it) and one Temporal has forgotten", async () => {
    const t = deps([run("a", 1), run("b", 2)], { a: { kind: "activity" }, b: { kind: "gone" } });
    expect(await reportFailedRuns(t.d)).toEqual({ seen: 2, reported: 0, skipped: 2, paused: false });
    expect(t.reported).toHaveLength(0);
  });

  it("looks at each run once", async () => {
    const t = deps([run("r1", 5)], { r1: { kind: "other", message: "m" } });
    await reportFailedRuns(t.d);
    expect((await reportFailedRuns(t.d)).seen).toBe(0);
    expect(t.reported).toHaveLength(1);
  });

  it("stops and tries again later when Temporal cannot be asked, keeping the order", async () => {
    const t = deps([run("a", 1), run("b", 2), run("c", 3)], { a: { kind: "other", message: "m" }, b: { kind: "unknown" }, c: { kind: "other", message: "m2" } });
    expect(await reportFailedRuns(t.d)).toMatchObject({ seen: 2, reported: 1, paused: true });
    expect(t.cursor()).toEqual(run("a", 1).completedAt);
    expect(t.reported).toHaveLength(1);
  });

  it("gives up on a run Temporal can no longer answer for after a day", async () => {
    const t = deps([run("old", 1)], { old: { kind: "unknown" } }, { now: () => new Date(T0.getTime() + 25 * 60 * 60_000) });
    expect(await reportFailedRuns(t.d)).toMatchObject({ skipped: 1, paused: false });
  });

  it("never throws", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = deps([], {}, { getCursor: async () => { throw new Error("db down"); } });
    await expect(reportFailedRuns(t.d)).resolves.toMatchObject({ reported: 0 });
    quiet.mockRestore();
  });

  it("feeds the real capture, so a workflow failure becomes one stored error", async () => {
    const t = deps([run("r1", 5), run("r2", 6)], { r1: { kind: "other", message: "Workflow execution timed out", name: "TimeoutFailure" }, r2: { kind: "other", message: "Workflow execution timed out", name: "TimeoutFailure" } }, { report: (e, i) => captureError(e, i) });
    await reportFailedRuns(t.d);
    const rows = await appDb.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "workflow", route: "workflow:Quote chase", name: "TimeoutFailure" });
  });
});

describe("a slow report never holds up the failing step", () => {
  it("fails with the real error after the wait even while the report is still running", async () => {
    vi.useFakeTimers();
    try {
      const { withErrorReporting, REPORT_WAIT_MS } = await import("../src/automation/errorHooks");
      const itModule = await import("../src/domain/it");
      const slow = vi.spyOn(itModule, "reportError").mockImplementation(() => new Promise(() => {}));
      const boom = new Error("real failure");
      const wrapped = withErrorReporting("sendEmail", async () => {
        throw boom;
      });
      const outcome = wrapped({}, {}).then(() => "ok", (e) => e);
      await vi.advanceTimersByTimeAsync(REPORT_WAIT_MS + 1);
      expect(await outcome).toBe(boom);
      slow.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
