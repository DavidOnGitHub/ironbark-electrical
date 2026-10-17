import { describe, expect, it } from "vitest";
import { canTransition, formatAge, isOpenStatus, REQUEST_STATUS_ORDER, REQUEST_TRANSITIONS, requestAgeHours } from "../src/domain/requests/status";

describe("request status rules", () => {
  it("allows the normal forward moves", () => {
    expect(canTransition("NEW", "CONTACTED")).toBe(true);
    expect(canTransition("CONTACTED", "QUOTED")).toBe(true);
    expect(canTransition("QUOTED", "WON")).toBe(true);
  });
  it("lets an enquiry go through a site visit, and back when the visit is cancelled", () => {
    expect(canTransition("CONTACTED", "SITE_VISIT_BOOKED")).toBe(true);
    expect(canTransition("SITE_VISIT_BOOKED", "QUOTED")).toBe(true);
    expect(canTransition("SITE_VISIT_BOOKED", "CONTACTED")).toBe(true);
  });
  it("blocks skipping to won and moving out of won", () => {
    expect(canTransition("NEW", "WON")).toBe(false);
    expect(canTransition("WON", "LOST")).toBe(false);
    expect(REQUEST_TRANSITIONS.WON).toEqual([]);
  });
  it("lets any open request be lost, and a lost one be reopened", () => {
    for (const s of REQUEST_STATUS_ORDER.filter(isOpenStatus)) expect(canTransition(s, "LOST"), s).toBe(true);
    expect(canTransition("LOST", "NEW")).toBe(true);
  });
  it("never lists a transition to the same status", () => {
    for (const s of REQUEST_STATUS_ORDER) expect(REQUEST_TRANSITIONS[s]).not.toContain(s);
  });
  it("knows which statuses are open", () => {
    expect(isOpenStatus("QUOTED")).toBe(true);
    expect(isOpenStatus("WON")).toBe(false);
    expect(isOpenStatus("LOST")).toBe(false);
  });
});

describe("request age", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("measures hours and never goes negative", () => {
    expect(requestAgeHours(new Date("2026-10-01T09:00:00Z"), now)).toBe(3);
    expect(requestAgeHours(new Date("2026-10-02T09:00:00Z"), now)).toBe(0);
  });
  it("formats as minutes, hours or days", () => {
    expect(formatAge(0.2)).toBe("12 min");
    expect(formatAge(0.001)).toBe("1 min");
    expect(formatAge(5.4)).toBe("5 h");
    expect(formatAge(47)).toBe("47 h");
    expect(formatAge(72)).toBe("3 d");
  });
});
