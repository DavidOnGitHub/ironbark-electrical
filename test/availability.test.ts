import { describe, expect, it } from "vitest";
import { computeFreeSlots, groupByDay, isFree, weekdayOf, type BusyWindow } from "../src/domain/availability/rules";
import { dayKey, formatTime, sydneyLocalToDate } from "../src/lib/tz";

const at = (local: string) => sydneyLocalToDate(local)!;
const hours = (slots: { start: Date }[]) => slots.map((s) => formatTime(s.start));
const MONDAY = "2026-10-19"; // a Monday
const base = { fromDay: MONDAY, days: 1, durationMinutes: 60, technicianIds: ["a", "b"], now: at("2026-10-18T07:00") };
const busy = (userId: string, from: string, to: string): BusyWindow => ({ userId, start: at(from), end: at(to) });

describe("free slots", () => {
  it("offers every working hour of a free weekday, and the last visit ends by closing time", () => {
    const slots = computeFreeSlots({ ...base, technicianIds: ["a"], busy: [] });
    expect(slots).toHaveLength(8);
    expect(slots[0]!.start).toEqual(at("2026-10-19T08:00"));
    expect(slots.at(-1)!.end).toEqual(at("2026-10-19T16:00"));
  });
  it("skips weekends", () => {
    expect(weekdayOf("2026-10-24")).toBe(6);
    const slots = computeFreeSlots({ ...base, fromDay: "2026-10-23", days: 3, technicianIds: ["a"], busy: [], now: at("2026-10-20T07:00") });
    expect(new Set(slots.map((s) => dayKey(s.start)))).toEqual(new Set(["2026-10-23"]));
  });
  it("needs minimum notice", () => {
    const slots = computeFreeSlots({ ...base, technicianIds: ["a"], busy: [], now: at("2026-10-19T06:00") });
    expect(slots).toHaveLength(0); // 12 hours' notice from 6am is 6pm: nothing left today
  });
  it("keeps a travel buffer either side of a booking", () => {
    const slots = computeFreeSlots({ ...base, technicianIds: ["a"], busy: [busy("a", "2026-10-19T10:00", "2026-10-19T11:00")] });
    expect(hours(slots)).toEqual(["8:00 am", "12:00 pm", "1:00 pm", "2:00 pm", "3:00 pm"]);
  });
  it("books the first technician, and the next only when the first is busy", () => {
    const window = [busy("a", "2026-10-19T09:00", "2026-10-19T10:00")];
    const slots = computeFreeSlots({ ...base, busy: window });
    expect(slots.find((s) => s.start.getTime() === at("2026-10-19T08:00").getTime())!.userId).toBe("b"); // a's buffer covers 8am
    expect(slots.find((s) => s.start.getTime() === at("2026-10-19T13:00").getTime())!.userId).toBe("a");
    expect(slots.length).toBe(8); // someone is free at every hour
  });
  it("drops a time when every technician is busy", () => {
    const window = [busy("a", "2026-10-19T09:00", "2026-10-19T10:00"), busy("b", "2026-10-19T09:00", "2026-10-19T10:00")];
    expect(hours(computeFreeSlots({ ...base, busy: window }))).not.toContain("9:00 am");
  });
  it("ignores other technicians' bookings", () => {
    expect(isFree("a", at("2026-10-19T09:00"), at("2026-10-19T10:00"), [busy("b", "2026-10-19T09:00", "2026-10-19T10:00")], 30)).toBe(true);
  });
  it("groups by Sydney day", () => {
    const grouped = groupByDay(computeFreeSlots({ ...base, days: 2, technicianIds: ["a"], busy: [] }), dayKey);
    expect(grouped.map((g) => g.day)).toEqual(["2026-10-19", "2026-10-20"]);
  });
});
