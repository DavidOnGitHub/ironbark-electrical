import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { demoBreakAvailable, DemoBreakError, isDemoBreakOn, setDemoBreak } from "../src/domain/demo";
import { captureError, resetErrorThrottle } from "../src/domain/it";
import { validityNote } from "../src/domain/quotes";
import { listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";
import { truncateAll } from "./helpers";

const owner: Actor = { type: "USER", userId: "u_owner", label: "Dave Owner" };
const staging = { IT_DEMO_BREAK: "on" };
const production = {};

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("the demo switch", () => {
  it("exists only where IT_DEMO_BREAK is on", () => {
    expect(demoBreakAvailable(staging)).toBe(true);
    expect(demoBreakAvailable(production)).toBe(false);
    expect(demoBreakAvailable({ IT_DEMO_BREAK: "true" })).toBe(false);
  });

  it("refuses to be switched on where it is not allowed, and leaves nothing behind", async () => {
    await expect(setDemoBreak(true, owner, production)).rejects.toBeInstanceOf(DemoBreakError);
    expect(await appDb.appFlag.count()).toBe(0);
  });

  it("ignores a stored 'on' where the environment does not allow it", async () => {
    await setDemoBreak(true, owner, staging);
    expect(await isDemoBreakOn(staging)).toBe(true);
    expect(await isDemoBreakOn(production)).toBe(false);
  });

  it("switches on and off, and records each change once", async () => {
    expect(await isDemoBreakOn(staging)).toBe(false);
    expect(await setDemoBreak(true, owner, staging)).toEqual({ enabled: true, changed: true });
    expect(await setDemoBreak(true, owner, staging)).toEqual({ enabled: true, changed: false });
    expect(await setDemoBreak(false, owner, staging)).toEqual({ enabled: false, changed: true });
    expect(await isDemoBreakOn(staging)).toBe(false);
    const timeline = await listEntityTimeline("appFlag", "demo-break");
    expect(timeline).toHaveLength(2);
    expect(timeline.every((e) => e.actorLabel === "Dave Owner")).toBe(true);
  });
});

describe("validityNote and the demo bug", () => {
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

  it("with the demo bug on, fails on a sent quote - the error the assistant is meant to find", () => {
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
