/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { AiBuilderError, resetParkingGuard, dismissFinding, fixSelectedFindings, openErrorFix, parkMinSeverity, parkOpenIssues, parkingOn, syncParkedRequests, type AiBuilderClient, type Responder } from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Dave Owner" }, userId: "u1", email: "dave@example.test", name: "Dave Owner", roles: ["ADMIN"] };
let n = 0;
/** A fake AI Builder: sessions are remembered so a test can say what a developer did to one. */
function fake() {
  const sessions = new Map<string, { status: string; events: any[] }>();
  const client = {
    createSession: vi.fn(async (input: any) => {
      const id = `s-${++n}`;
      sessions.set(id, { status: input.parked ? "parked" : "working", events: [] });
      return { id, appId: "i", intent: input.intent, title: "t", status: input.parked ? "parked" : "working", costUsd: 0, prUrl: null };
    }),
    getSession: vi.fn(async (id: string) => {
      const s = sessions.get(id)!;
      return { session: { id, appId: "i", intent: "bugfix", title: "t", status: s.status, costUsd: 0, prUrl: null }, events: s.events, acceptance: null };
    }),
    dismiss: vi.fn(async (id: string, reason?: string) => {
      const s = sessions.get(id)!;
      if (s.status !== "parked") throw new AiBuilderError(409, "Only a parked session can be dismissed");
      s.status = "closed";
      s.events.push({ type: "dismissed", reason });
    }),
    cancel: vi.fn(async () => undefined),
  } as unknown as AiBuilderClient & { createSession: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  return { client, sessions };
}

const error = (over: Record<string, unknown> = {}) =>
  appDb.errorEvent.create({ data: { fingerprint: `fp-${Math.random().toString(36).slice(2)}`, name: "Error", message: "Boom", source: "request", route: "/quotes", classification: "bad_data", classConfidence: "high", classifiedAt: new Date(), ...over } as any });
const finding = (over: Record<string, unknown> = {}) =>
  appDb.finding.create({ data: { fingerprint: `f-${Math.random().toString(36).slice(2)}`, tool: "semgrep", ruleId: "r", severity: "HIGH", message: "Unsafe thing", file: "src/a.ts", line: 3, lastScanId: "s", firstScanId: "s", ...over } as any });

beforeEach(async () => {
  resetParkingGuard();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("settings", () => {
  it("is on unless switched off, and parks from MEDIUM up by default", () => {
    expect(parkingOn({})).toBe(true);
    expect(parkingOn({ IT_PARK_ISSUES: " OFF" })).toBe(false);
    expect(parkMinSeverity({})).toBe("MEDIUM");
    expect(parkMinSeverity({ IT_PARK_MIN_SEVERITY: "high" })).toBe("HIGH");
    expect(parkMinSeverity({ IT_PARK_MIN_SEVERITY: "nonsense" })).toBe("MEDIUM");
  });
});

describe("handing issues to AI Builder", () => {
  it("parks an error and a security finding, with nothing started", async () => {
    const e = await error();
    const f = await finding();
    const { client } = fake();
    expect(await parkOpenIssues(client, {})).toEqual({ parked: 2, closed: 0 });
    expect(client.createSession).toHaveBeenCalledTimes(2);
    for (const [input] of client.createSession.mock.calls) expect(input).toMatchObject({ parked: true });
    expect(client.createSession.mock.calls.map(([i]) => i.issue)).toEqual([{ kind: "error", ref: expect.stringMatching(/^IT-/) }, { kind: "finding", severity: "high", ref: expect.stringMatching(/^IT-/) }]);
    const rows = await appDb.itRequest.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.kind, r.status, r.parked, r.sourceType, r.sourceId])).toEqual([
      ["ERROR", "PARKED", true, "error", e.id],
      ["FINDING", "PARKED", true, "finding", f.id],
    ]);
    expect(rows.every((r) => r.sessionId)).toBe(true);
  });

  it("does nothing twice, and not at all when off or not connected", async () => {
    await error();
    const { client } = fake();
    expect((await parkOpenIssues(client, {})).parked).toBe(1);
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
    await error();
    expect((await parkOpenIssues(client, { IT_PARK_ISSUES: "off" })).parked).toBe(0);
    expect((await parkOpenIssues(null, {})).parked).toBe(0);
  });

  it("leaves out findings below the minimum severity, errors not classified yet, and dismissed or fixed items", async () => {
    await finding({ severity: "LOW" });
    await finding({ severity: "INFO" });
    await finding({ status: "ACCEPTED_RISK" });
    await error({ classifiedAt: null, classification: null });
    await error({ resolvedAt: new Date() });
    const { client } = fake();
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
    expect((await parkOpenIssues(client, { IT_PARK_MIN_SEVERITY: "LOW" })).parked).toBe(1);
  });

  it("leaves out an error the assistant is going to fix by itself, but not one it will not", async () => {
    await error({ classification: "code_bug", classConfidence: "high" });
    await error({ classification: "code_bug", classConfidence: "low" });
    await error({ classification: "external_outage" });
    const { client } = fake();
    expect((await parkOpenIssues(client, { IT_AUTOFIX: "on" })).parked).toBe(2);
    await truncateAll();
    await error({ classification: "code_bug", classConfidence: "high" });
    expect((await parkOpenIssues(client, {})).parked).toBe(1);
  });

  it("hands over a limited number at a time, worst findings first", async () => {
    for (let i = 0; i < 12; i++) await finding({ severity: i === 11 ? "CRITICAL" : "MEDIUM" });
    const { client } = fake();
    expect((await parkOpenIssues(client, {})).parked).toBe(10);
    expect(client.createSession.mock.calls[0]![0].context.finding.severity).toBe("CRITICAL");
    expect((await parkOpenIssues(client, {})).parked).toBe(2);
  });

  it("leaves nothing behind when AI Builder refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await finding();
    const { client } = fake();
    client.createSession.mockRejectedValueOnce(new AiBuilderError(500, "down"));
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
    expect(await appDb.itRequest.count()).toBe(0);
    expect((await parkOpenIssues(client, {})).parked).toBe(1);
  });
});

describe("an AI Builder that does not know parked issues", () => {
  it("is stopped after the first one: that session is cancelled and nothing more is handed over", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await finding();
    await finding();
    const { client } = fake();
    client.createSession.mockImplementationOnce(async () => ({ id: "old-1", appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null }));
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect((client as any).cancel).toHaveBeenCalledWith("old-1", expect.anything());
    expect(await appDb.itRequest.count()).toBe(0);
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });
});

describe("what a developer does in AI Builder", () => {
  it("dismissing a finding there closes it here as accepted, with the reason, and it is not parked again", async () => {
    const f = await finding();
    const { client, sessions } = fake();
    await parkOpenIssues(client, {});
    const row = await appDb.itRequest.findFirstOrThrow();
    const s = sessions.get(row.sessionId!)!;
    s.status = "closed";
    s.events.push({ type: "dismissed", reason: "Internal tool" });
    expect(await syncParkedRequests(client)).toEqual({ checked: 1, changed: 1 });
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CLOSED");
    expect((await appDb.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("ACCEPTED_RISK");
    const log = await appDb.activityEvent.findFirstOrThrow({ where: { entityType: "finding", kind: "DISMISSED" } });
    expect(log.body).toBe("Internal tool");
    expect((await parkOpenIssues(client, {})).parked).toBe(0);
  });

  it("dismissing an error there marks it resolved here", async () => {
    const e = await error();
    const { client, sessions } = fake();
    await parkOpenIssues(client, {});
    const row = await appDb.itRequest.findFirstOrThrow();
    sessions.get(row.sessionId!)!.status = "closed";
    sessions.get(row.sessionId!)!.events.push({ type: "dismissed" });
    await syncParkedRequests(client);
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id: e.id } })).resolvedAt).not.toBeNull();
  });

  it("starting a fix there makes it a normal request, and the finding is being fixed", async () => {
    const f = await finding();
    const { client, sessions } = fake();
    await parkOpenIssues(client, {});
    const row = await appDb.itRequest.findFirstOrThrow();
    sessions.get(row.sessionId!)!.status = "working";
    await syncParkedRequests(client);
    const after = await appDb.itRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("DRAFTING_SPEC");
    expect(await appDb.finding.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "FIXING", itRequestId: row.id });
    // From here it is synced like any other request, and no longer by the parked pass.
    expect((await syncParkedRequests(client)).checked).toBe(0);
  });

  it("an issue still parked is left alone", async () => {
    await finding();
    const { client } = fake();
    await parkOpenIssues(client, {});
    expect(await syncParkedRequests(client)).toEqual({ checked: 1, changed: 0 });
    expect((await appDb.itRequest.findFirstOrThrow()).status).toBe("PARKED");
  });
});

describe("what is decided in Ironbark first", () => {
  it("dismissing a parked finding here closes its session in AI Builder", async () => {
    const f = await finding();
    const { client } = fake();
    await parkOpenIssues(client, {});
    await dismissFinding({ id: f.id, status: "ACCEPTED_RISK", reason: "Internal tool only" }, owner, client);
    expect(client.dismiss).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Internal tool only"));
    expect((await appDb.itRequest.findFirstOrThrow()).status).toBe("CLOSED");
    expect((await appDb.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("ACCEPTED_RISK");
  });

  it("a person choosing to fix a parked finding here takes it over, and a developer already on it is left alone", async () => {
    const a = await finding({ message: "Weakness A" });
    const { client, sessions } = fake();
    await parkOpenIssues(client, {});
    const parked = await appDb.itRequest.findFirstOrThrow();
    const res = await fixSelectedFindings([a.id], owner, client, {});
    expect(res.opened).toBe(true);
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: parked.id } })).status).toBe("CLOSED");
    expect(sessions.get(parked.sessionId!)!.status).toBe("closed");
    expect(await appDb.itRequest.count({ where: { parked: false, kind: "FINDING" } })).toBe(1);

    await truncateAll();
    const b = await finding();
    await parkOpenIssues(client, {});
    const row = await appDb.itRequest.findFirstOrThrow();
    sessions.get(row.sessionId!)!.status = "working"; // a developer started it, not yet seen by the sync
    const second = await fixSelectedFindings([b.id], owner, client, {});
    expect(second.opened).toBe(false);
    expect(second.skipped[0]!.reason).toMatch(/developer is already working/);
  });

  it("an error the assistant now fixes by itself takes over from the parked issue, and the parked one is not an attempt", async () => {
    const e = await error({ classification: "code_bug", classConfidence: "high" });
    const { client, sessions } = fake();
    await parkOpenIssues(client, {}); // autofix was off
    const parked = await appDb.itRequest.findFirstOrThrow();
    const res = await openErrorFix(e.id, client, { IT_AUTOFIX: "on" });
    expect(res.opened).toBe(true);
    expect(sessions.get(parked.sessionId!)!.status).toBe("closed");
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: parked.id } })).status).toBe("CLOSED");
    expect(await appDb.itRequest.count({ where: { parked: false, sourceId: e.id } })).toBe(1);
  });

  it("an error that is resolved here has its parked issue closed by the next pass", async () => {
    const e = await error();
    const { client, sessions } = fake();
    await parkOpenIssues(client, {});
    await appDb.errorEvent.update({ where: { id: e.id }, data: { resolvedAt: new Date() } });
    expect(await parkOpenIssues(client, {})).toEqual({ parked: 0, closed: 1 });
    expect([...sessions.values()][0]!.status).toBe("closed");
  });
});
