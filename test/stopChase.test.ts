import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_IDS, rejectStaleQuoteApprovals, stopQuoteChase, type RejectDeps, type StopDeps } from "../src/automation";

const run = (id: string, quoteId: string) => ({ id, context: { trigger: { quoteId } } });

describe("stopQuoteChase", () => {
  it("stops only the runs for that quote, and marks them finished", async () => {
    const cancel = vi.fn(async () => {});
    const finish = vi.fn(async () => {});
    const findRunning = vi.fn(async () => [run("r1", "q1"), run("r2", "q2"), run("r3", "q1"), { id: "r4", context: null }]);
    const n = await stopQuoteChase("q1", { findRunning, cancel, finish });
    expect(n).toBe(2);
    expect(findRunning).toHaveBeenCalledWith(AUTOMATION_IDS.quoteChase);
    expect(cancel.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["r1", "r3"]);
    expect(finish.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["r1", "r3"]);
  });
  it("still finishes the run when Temporal cannot cancel it, and never throws", async () => {
    const finish = vi.fn(async () => {});
    const deps: StopDeps = { findRunning: async () => [run("r1", "q1")], cancel: async () => { throw new Error("temporal down"); }, finish };
    expect(await stopQuoteChase("q1", deps)).toBe(1);
    expect(finish).toHaveBeenCalledWith("r1");
    const broken: StopDeps = { findRunning: async () => { throw new Error("db down"); }, cancel: async () => {}, finish };
    expect(await stopQuoteChase("q1", broken)).toBe(0);
  });
});

describe("rejectStaleQuoteApprovals", () => {
  const task = (id: string, quoteId: string) => ({ id, instanceId: `i-${id}`, nodeId: "approve_quote", context: { draft: { quoteId } } });

  it("rejects every pending approval for that quote and no others", async () => {
    const markRejected = vi.fn(async () => {});
    const signal = vi.fn(async () => {});
    const findPending = vi.fn(async () => [task("t1", "q1"), task("t2", "q2"), task("t3", "q1"), { id: "t4", instanceId: "i4", nodeId: "n", context: null }]);
    const n = await rejectStaleQuoteApprovals("q1", { findPending, markRejected, restore: async () => {}, signal });
    expect(n).toBe(2);
    expect(findPending).toHaveBeenCalledWith(AUTOMATION_IDS.visitToQuote);
    expect(markRejected.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["t1", "t3"]);
    expect(signal).toHaveBeenCalledWith("i-t1", "approve_quote", { approved: false });
  });

  it("puts a task back to pending when the run cannot be signalled, and never throws", async () => {
    const restore = vi.fn(async () => {});
    const deps: RejectDeps = { findPending: async () => [task("t1", "q1")], markRejected: async () => {}, restore, signal: async () => { throw new Error("temporal down"); } };
    expect(await rejectStaleQuoteApprovals("q1", deps)).toBe(0);
    expect(restore).toHaveBeenCalledWith("t1");
    const broken: RejectDeps = { ...deps, findPending: async () => { throw new Error("db down"); } };
    expect(await rejectStaleQuoteApprovals("q1", broken)).toBe(0);
  });
});
