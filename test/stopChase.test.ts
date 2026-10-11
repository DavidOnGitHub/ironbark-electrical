import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_IDS, stopQuoteChase, type StopDeps } from "../src/automation";

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
