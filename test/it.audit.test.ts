/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { AUDIT_PAGE, isAuditActor, isAuditFilter, listAudit } from "../src/domain/it";
import { truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

const T = (m: number) => new Date(Date.UTC(2026, 10, 17, 0, m));
async function log(entityType: string, summary: string, at: Date, over: Record<string, unknown> = {}) {
  return appDb.activityEvent.create({ data: { actorType: "SYSTEM", actorLabel: "IT assistant", entityType, entityId: "e1", kind: "UPDATED", summary, at, ...over } as any });
}

describe("listAudit", () => {
  it("shows only IT entries, newest first, with who did each", async () => {
    await log("itRequest", "first", T(1));
    await log("release", "second", T(2), { actorType: "USER", actorLabel: "Sam Walker" });
    await log("quote", "not IT at all", T(3));
    const { lines, next } = await listAudit();
    expect(lines.map((l) => l.summary)).toEqual(["second", "first"]);
    expect(lines[0]).toMatchObject({ actorType: "USER", actor: "Sam Walker", entity: "release" });
    expect(next).toBeNull();
  });

  it("filters by what it was about and by people or the assistant", async () => {
    await log("itRequest", "a", T(1));
    await log("finding", "b", T(2), { actorType: "USER", actorLabel: "Sam Walker" });
    await log("finding", "c", T(3));
    expect((await listAudit({ filter: "findings" })).lines.map((l) => l.summary)).toEqual(["c", "b"]);
    expect((await listAudit({ actor: "people" })).lines.map((l) => l.summary)).toEqual(["b"]);
    expect((await listAudit({ filter: "findings", actor: "assistant" })).lines.map((l) => l.summary)).toEqual(["c"]);
  });

  it("names the request an entry is about", async () => {
    const r = await appDb.itRequest.create({ data: { number: "IT-2001", kind: "FEATURE", title: "Change a label", description: "d", requestedByLabel: "Sam" } as any });
    await log("itRequest", "approved the plan", T(1), { entityId: r.id });
    const [line] = (await listAudit()).lines;
    expect(line!.request).toEqual({ id: r.id, number: "IT-2001", kind: "FEATURE", title: "Change a label" });
  });

  it("pages without losing or repeating entries, even when several share a time", async () => {
    for (let i = 0; i < AUDIT_PAGE + 5; i++) await log("itRequest", `n${i}`, T(i < 10 ? 0 : i));
    const first = await listAudit();
    expect(first.lines).toHaveLength(AUDIT_PAGE);
    expect(first.next).toBeTruthy();
    const second = await listAudit({ before: first.next });
    expect(second.lines).toHaveLength(5);
    expect(second.next).toBeNull();
    const all = [...first.lines, ...second.lines].map((l) => l.summary);
    expect(new Set(all).size).toBe(AUDIT_PAGE + 5);
  });

  it("ignores a cursor it cannot read", async () => {
    await log("itRequest", "a", T(1));
    expect((await listAudit({ before: "garbage" })).lines).toHaveLength(1);
    expect((await listAudit({ before: "not-a-date_x" })).lines).toHaveLength(1);
  });

  it("recognises only real filter values", () => {
    expect(isAuditFilter("findings")).toBe(true);
    expect(isAuditFilter("everything; drop")).toBe(false);
    expect(isAuditActor("people")).toBe(true);
    expect(isAuditActor("nobody")).toBe(false);
  });
});
