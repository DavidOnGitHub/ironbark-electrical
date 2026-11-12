import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { DEMO_BUGS, demoBreakAvailable, DemoBreakError, demoBugFlagKey, isDemoBugOn, listDemoBugs, resetDemoBugs, setDemoBug } from "../src/domain/demo";
import { captureError, resetErrorThrottle } from "../src/domain/it";
import { validityNote } from "../src/domain/quotes";
import { dueNote } from "../src/domain/invoicing/dueNote";
import { visitNote } from "../src/domain/jobs/visitNote";
import { listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";
import { truncateAll } from "./helpers";

const owner: Actor = { type: "USER", userId: "u_owner", label: "Dave Owner" };
const staging = { IT_DEMO_BREAK: "on" };
const production = {};
const QUOTE = "quote-validity";

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("the demo switches", () => {
  it("exists only where IT_DEMO_BREAK is on", () => {
    expect(demoBreakAvailable(staging)).toBe(true);
    expect(demoBreakAvailable(production)).toBe(false);
    expect(demoBreakAvailable({ IT_DEMO_BREAK: "true" })).toBe(false);
  });

  it("has a pool of bugs with unique ids", () => {
    expect(DEMO_BUGS.length).toBeGreaterThanOrEqual(2);
    expect(DEMO_BUGS.some((b) => b.id === "invoice-due")).toBe(false);
    expect(new Set(DEMO_BUGS.map((b) => b.id)).size).toBe(DEMO_BUGS.length);
  });

  it("refuses to be switched on where it is not allowed, and leaves nothing behind", async () => {
    await expect(setDemoBug(QUOTE, true, owner, production)).rejects.toBeInstanceOf(DemoBreakError);
    expect(await appDb.appFlag.count()).toBe(0);
  });

  it("refuses a bug that is not in the pool", async () => {
    await expect(setDemoBug("nope", true, owner, staging)).rejects.toBeInstanceOf(DemoBreakError);
    expect(await appDb.appFlag.count()).toBe(0);
    expect(await isDemoBugOn("nope", staging)).toBe(false);
  });

  it("ignores a stored 'on' where the environment does not allow it", async () => {
    await setDemoBug(QUOTE, true, owner, staging);
    expect(await isDemoBugOn(QUOTE, staging)).toBe(true);
    expect(await isDemoBugOn(QUOTE, production)).toBe(false);
    expect((await listDemoBugs(production)).every((b) => !b.on)).toBe(true);
  });

  it("switches on and off, and records each change once", async () => {
    expect(await isDemoBugOn(QUOTE, staging)).toBe(false);
    expect(await setDemoBug(QUOTE, true, owner, staging)).toEqual({ enabled: true, changed: true });
    expect(await setDemoBug(QUOTE, true, owner, staging)).toEqual({ enabled: true, changed: false });
    expect(await isDemoBugOn(QUOTE, staging)).toBe(true);
    expect(await setDemoBug(QUOTE, false, owner, staging)).toEqual({ enabled: false, changed: true });
    expect(await isDemoBugOn(QUOTE, staging)).toBe(false);
    const timeline = await listEntityTimeline("appFlag", demoBugFlagKey(QUOTE));
    expect(timeline).toHaveLength(2);
    expect(timeline.every((e) => e.actorLabel === "Dave Owner")).toBe(true);
  });

  it("keeps each bug's switch separate, lists them, and resets them all", async () => {
    await setDemoBug("job-schedule", true, owner, staging);
    expect(await isDemoBugOn(QUOTE, staging)).toBe(false);
    expect(await isDemoBugOn("job-schedule", staging)).toBe(true);
    const on = (await listDemoBugs(staging)).filter((b) => b.on).map((b) => b.id).sort();
    expect(on).toEqual(["job-schedule"]);
    await setDemoBug(QUOTE, true, owner, staging);
    expect(await resetDemoBugs(owner, staging)).toBe(2);
    expect((await listDemoBugs(staging)).some((b) => b.on)).toBe(false);
    expect(await resetDemoBugs(owner, staging)).toBe(0);
  });
});

describe("validityNote and the quote-validity bug", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  const sent = { status: "SENT" as const, validUntil: new Date("2026-11-09T00:00:00Z"), decidedAt: null };

  it("tells how long a sent quote has left", () => {
    expect(validityNote(sent, now)).toBe("3 days left");
    expect(validityNote({ ...sent, validUntil: new Date("2026-11-07T00:00:00Z") }, now)).toBe("1 day left");
    expect(validityNote({ ...sent, validUntil: now }, now)).toBe("expires today");
    expect(validityNote({ ...sent, validUntil: new Date("2026-11-01T00:00:00Z") }, now)).toBe("expired");
  });

  it("says nothing for a quote that is not waiting for an answer", () => {
    expect(validityNote({ ...sent, status: "DRAFT" }, now)).toBeNull();
    expect(validityNote({ ...sent, status: "APPROVED", decidedAt: now }, now)).toBeNull();
  });

  it("with the bug on, fails on a sent quote - the error the assistant is meant to find", () => {
    expect(() => validityNote(sent, now, true)).toThrow(TypeError);
    expect(validityNote({ ...sent, status: "DRAFT" }, now, true)).toBeNull();
  });

  it("the failure is captured as one stable error however many sent quotes trigger it", async () => {
    const hit = () => {
      try {
        validityNote(sent, now, true);
      } catch (e) {
        return e;
      }
    };
    await captureError(hit(), { source: "request", route: "/quotes" });
    resetErrorThrottle();
    await captureError(hit(), { source: "request", route: "/quotes" });
    const rows = await appDb.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, route: "/quotes", name: "TypeError" });
  });
});

describe("dueNote", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  const sent = { status: "SENT", dueAt: new Date("2026-11-09T00:00:00Z"), paidAt: null };

  it("tells how long an issued invoice has left, or how late it is", () => {
    expect(dueNote(sent, now)).toBe("due in 3 days");
    expect(dueNote({ ...sent, dueAt: new Date("2026-11-07T00:00:00Z") }, now)).toBe("due in 1 day");
    expect(dueNote({ ...sent, dueAt: now }, now)).toBe("due today");
    expect(dueNote({ ...sent, dueAt: new Date("2026-11-05T00:00:00Z") }, now)).toBe("1 day late");
    expect(dueNote({ ...sent, status: "PARTIALLY_PAID", dueAt: new Date("2026-11-03T00:00:00Z") }, now)).toBe("3 days late");
  });

  it("says nothing for a draft, a paid or a voided invoice, or one with no due date", () => {
    for (const status of ["DRAFT", "PAID", "VOID"]) expect(dueNote({ ...sent, status }, now)).toBeNull();
    expect(dueNote({ ...sent, dueAt: null }, now)).toBeNull();
  });

  it("AC-1 AC-2 does not throw on an unpaid invoice even when called the old way with the demo switch on", () => {
    // The page used to pass a third `demoBug` argument; the parameter is gone, so call through a loose type.
    const legacy = dueNote as (i: typeof sent, now: Date, demoBug: boolean) => string | null;
    expect(() => legacy(sent, now, true)).not.toThrow();
    expect(legacy(sent, now, true)).toBe("due in 3 days");
    expect(legacy({ ...sent, status: "PARTIALLY_PAID", dueAt: new Date("2026-11-05T00:00:00Z") }, now, true)).toBe("1 day late");
    expect(legacy({ ...sent, status: "DRAFT" }, now, true)).toBeNull();
  });

  it("AC-2 measures from now for a partly paid invoice whether or not paidAt is set", () => {
    const partly = { ...sent, status: "PARTIALLY_PAID" };
    expect(dueNote(partly, now)).toBe("due in 3 days");
    expect(dueNote({ ...partly, paidAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe("due in 3 days");
  });
});

describe("visitNote and the job-schedule bug", () => {
  const scheduled = { status: "SCHEDULED", scheduledStart: new Date("2026-11-09T22:00:00Z"), scheduledEnd: new Date("2026-11-10T02:00:00Z") };
  const unscheduled = { status: "UNSCHEDULED", scheduledStart: null, scheduledEnd: null };

  it("tells how long a booked visit is, and nothing for a job that is not scheduled", () => {
    expect(visitNote(scheduled)).toBe("4 h visit");
    expect(visitNote(unscheduled)).toBeNull();
    expect(visitNote({ ...scheduled, scheduledEnd: scheduled.scheduledStart })).toBeNull();
  });

  it("with the bug on, fails on a job that is not scheduled yet - the error the assistant is meant to find", () => {
    expect(() => visitNote(unscheduled, true)).toThrow(TypeError);
    expect(visitNote(scheduled, true)).toBe("4 h visit");
  });
});
