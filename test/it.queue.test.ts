import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { advanceFixQueue, captureError, fixQueueOn, IN_FLIGHT, laneBusy, openErrorFix, queuedFixCounts, resetErrorThrottle, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

const stackFor = (fn: string) => `TypeError: Cannot read properties of undefined (reading 'total')\n    at ${fn} (/app/.next/server/chunks/1.js:1:1)\n    at handler (/app/.next/server/chunks/2.js:2:2)`;
const boom = (fn: string) => Object.assign(new TypeError("Cannot read properties of undefined (reading 'total')"), { stack: stackFor(fn) });
const on = { IT_AUTOFIX: "on" };
let n = 0;
const client = () => ({ createSession: vi.fn(async () => ({ id: `q-${++n}`, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null })) }) as unknown as AiBuilderClient;
const capture = async (route: string, fn: string) => (await captureError(boom(fn), { source: "request", route })).id!;

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("the fix lanes", () => {
  it("counts a request as in flight until it merges or stops", () => {
    for (const s of ["SUBMITTED", "DRAFTING_SPEC", "SPEC_REVIEW", "BUILDING", "PR_OPEN", "ACCEPTED"]) expect(IN_FLIGHT).toContain(s);
    for (const s of ["MERGED", "LIVE", "CLOSED", "FAILED", "BUILD_FAILED", "DEPLOY_FAILED", "PROPOSED", "APPLIED"]) expect(IN_FLIGHT).not.toContain(s);
  });

  it("can be switched off", () => {
    expect(fixQueueOn({})).toBe(true);
    expect(fixQueueOn({ IT_FIX_QUEUE: " OFF " })).toBe(false);
  });

  it("holds a second error fix until the first has merged", async () => {
    const a = await capture("/a", "fnA");
    const b = await capture("/b", "fnB");
    const c = client();
    expect((await openErrorFix(a, c, on)).opened).toBe(true);
    const second = await openErrorFix(b, c, on);
    expect(second).toMatchObject({ opened: false, reason: expect.stringMatching(/^Waiting for IT-\d+ to finish first/) });
    expect(await appDb.itRequest.count()).toBe(1);
    expect(await laneBusy("ERROR")).not.toBeNull();
    expect(await laneBusy("FINDING")).toBeNull(); // separate lanes

    // The queue does not move while the first is in flight, and the waiting one is counted.
    expect(await advanceFixQueue(c, on)).toEqual({ errors: 0, findings: 0 });
    expect(await queuedFixCounts()).toEqual({ errors: 1, findings: 0 });

    // Once the first has merged, the next minute's tick opens the second.
    await appDb.itRequest.updateMany({ data: { status: "MERGED" } });
    expect(await advanceFixQueue(c, on)).toEqual({ errors: 1, findings: 0 });
    expect(await appDb.itRequest.count()).toBe(2);
    expect(await queuedFixCounts()).toEqual({ errors: 0, findings: 0 });
  });

  it("does not make an error wait for its own earlier attempt", async () => {
    const a = await capture("/a", "fnA");
    const c = client();
    await openErrorFix(a, c, on);
    const again = await openErrorFix(a, c, on);
    expect(again.reason).not.toMatch(/^Waiting for/);
    expect(await appDb.itRequest.count()).toBe(1);
  });

  it("does nothing to move the queue when auto-fix is off", async () => {
    const a = await capture("/a", "fnA");
    await openErrorFix(a, client(), {}); // classified, not opened
    expect(await advanceFixQueue(client(), {})).toEqual({ errors: 0, findings: 0 });
    expect(await appDb.itRequest.count()).toBe(0);
  });

  it("lets error fixes run side by side when IT_FIX_QUEUE is off", async () => {
    const a = await capture("/a", "fnA");
    const b = await capture("/b", "fnB");
    const env = { ...on, IT_FIX_QUEUE: "off" };
    expect((await openErrorFix(a, client(), env)).opened).toBe(true);
    expect((await openErrorFix(b, client(), env)).opened).toBe(true);
  });

  it("does not start anything without AI Builder", async () => {
    await capture("/a", "fnA");
    expect(await advanceFixQueue(null, on)).toEqual({ errors: 0, findings: 0 });
  });
});
