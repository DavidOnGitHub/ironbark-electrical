import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { captureError, fingerprintOf, normaliseRoute, openErrorFix, reportError, resetErrorThrottle, resolveErrorsFor, scrub, topFrames, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

const stackAt = (line: number) => `TypeError: Cannot read properties of undefined (reading 'total')\n    at computeTotal (/app/.next/server/chunks/${line}.js:${line}:13)\n    at renderQuote (/app/.next/server/app/quotes/page.js:1:${line})\n    at node:internal/process/task_queues:95:5`;
const boom = (line = 10, message = "Cannot read properties of undefined (reading 'total')") => Object.assign(new TypeError(message), { stack: stackAt(line) });
const input = { source: "request" as const, route: "/quotes/[id]" };
const env = { IT_AUTOFIX: "on" };

let n = 0;
const fakeClient = () => ({ createSession: vi.fn(async () => ({ id: `err-sess-${++n}`, appId: "ironbark", intent: "bugfix", title: "T", status: "working", costUsd: 0, prUrl: null })) }) as unknown as AiBuilderClient & { createSession: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  resetErrorThrottle();
  await truncateAll();
});
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("scrub", () => {
  it("removes emails, tokens, keys, card numbers and query values", () => {
    const text = scrub("Failed for dave@example.com with Bearer abcdef123456 key sk_live_abcdef123456 card 4242 4242 4242 4242 at /pay?token=zzzz1111&x=1");
    expect(text).not.toMatch(/dave@example|abcdef123456|4242|zzzz1111/);
    expect(text).toContain("[email]");
  });
  it("redacts jwts, long hex and secret assignments", () => {
    expect(scrub("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk")).toBe("[jwt]");
    expect(scrub("password=hunter2hunter2")).not.toContain("hunter2");
    expect(scrub("id a".padEnd(10) + "0123456789abcdef0123456789abcdef0123")).toContain("[hex]");
  });
});

describe("fingerprint", () => {
  it("is stable across line numbers, chunk names, record ids and quoted values", () => {
    const a = fingerprintOf(boom(10, "Quote q_1 not found: 'Priya Nair' (id 4821)"), "/quotes/123");
    const b = fingerprintOf(boom(990, "Quote q_9 not found: 'Sam Lee' (id 77)"), "/quotes/456");
    expect(a).toBe(b);
  });
  it("differs for a different error, route or code path", () => {
    const base = fingerprintOf(boom(), "/quotes/[id]");
    expect(fingerprintOf(boom(), "/jobs/[id]")).not.toBe(base);
    expect(fingerprintOf(boom(10, "Something else entirely"), "/quotes/[id]")).not.toBe(base);
    const other = boom();
    other.stack = other.stack!.replace("computeTotal", "otherFn");
    expect(fingerprintOf(other, "/quotes/[id]")).not.toBe(base);
  });
  it("uses application frames only", () => {
    expect(topFrames(stackAt(1))).toEqual(["computeTotal", "renderQuote"]);
  });
  it("turns ids in a path into a pattern", () => {
    expect(normaliseRoute("/quotes/cabcdefghijklmnopqrstuvwx/lines/42?x=1")).toBe("/quotes/[id]/lines/[id]");
  });
});

describe("captureError", () => {
  it("stores a scrubbed error once and counts repeats", async () => {
    const first = await captureError(boom(10, "Failed for dave@example.com"), { ...input, userRole: "EDITOR", release: "abc123" });
    expect(first).toMatchObject({ stored: true, isNew: true, regressed: false });
    resetErrorThrottle();
    const again = await captureError(boom(20, "Failed for sam@example.com"), { ...input, release: "def456" });
    expect(again).toMatchObject({ stored: true, isNew: false });
    const rows = await appDb.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, firstRelease: "abc123", lastRelease: "def456", userRole: "EDITOR", route: "/quotes/[id]" });
    expect(JSON.stringify(rows[0])).not.toMatch(/example\.com/);
  });

  it("keeps only allow-listed context", async () => {
    await captureError(boom(), { ...input, context: { method: "POST", cookie: "session=abc", body: { name: "Priya" }, routeType: "action" } });
    expect((await appDb.errorEvent.findFirstOrThrow()).context).toEqual({ method: "POST", routeType: "action" });
  });

  it("throttles the same fingerprint, then lets it through later", async () => {
    const t = new Date("2026-11-06T10:00:00Z");
    expect((await captureError(boom(), { ...input, now: t })).stored).toBe(true);
    expect((await captureError(boom(), { ...input, now: new Date(t.getTime() + 500) })).stored).toBe(false);
    expect((await captureError(boom(), { ...input, now: new Date(t.getTime() + 3000) })).stored).toBe(true);
    expect((await appDb.errorEvent.findFirstOrThrow()).count).toBe(2);
  });

  it("caps captures per minute across fingerprints", async () => {
    const t = new Date("2026-11-06T10:00:00Z");
    let stored = 0;
    for (let i = 0; i < 70; i++) if ((await captureError(new Error(`distinct failure number word${"x".repeat(i)}`), { source: "request", route: `/r${i}`, now: t })).stored) stored++;
    expect(stored).toBe(60);
  });

  it("ignores redirects and not-found throws", async () => {
    expect((await captureError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x" }), input)).stored).toBe(false);
    expect(await appDb.errorEvent.count()).toBe(0);
  });

  it("never throws, even when the error itself cannot be read", async () => {
    const hostile = { get message(): string { throw new Error("getter blew up"); } };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureError(hostile, input)).resolves.toEqual({ stored: false });
    quiet.mockRestore();
  });

  it("treats a return after the fix as a regression, but not an old instance still draining", async () => {
    const t = new Date("2026-11-06T10:00:00Z");
    const { id } = await captureError(boom(), { ...input, now: t });
    await appDb.errorEvent.update({ where: { id: id! }, data: { resolvedAt: t } });
    resetErrorThrottle();
    const draining = await captureError(boom(), { ...input, now: new Date(t.getTime() + 60_000) });
    expect(draining).toMatchObject({ stored: true, regressed: false });
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id: id! } })).resolvedAt).not.toBeNull();
    resetErrorThrottle();
    const back = await captureError(boom(), { ...input, now: new Date(t.getTime() + 30 * 60_000) });
    expect(back).toMatchObject({ stored: true, regressed: true });
    expect(await appDb.errorEvent.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({ resolvedAt: null, regressions: 1 });
  });
});

describe("openErrorFix", () => {
  const seed = async () => (await captureError(boom(), input)).id!;

  it("does nothing unless auto-fix is switched on", async () => {
    const client = fakeClient();
    const id = await seed();
    expect(await openErrorFix(id, client, {})).toMatchObject({ opened: false, reason: "Auto-fix is off" });
    expect(client.createSession).not.toHaveBeenCalled();
    expect(await appDb.itRequest.count()).toBe(0);
  });

  it("opens a bugfix request with the error as data, and does not open a second while one is open", async () => {
    const client = fakeClient();
    const id = await seed();
    const r = await openErrorFix(id, client, env);
    expect(r.opened).toBe(true);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    const sent = client.createSession.mock.calls[0][0];
    expect(sent.intent).toBe("bugfix");
    expect(sent.text).toContain("failing test");
    expect(sent.context.error).toMatchObject({ name: "TypeError", route: "/quotes/[id]" });
    expect(await appDb.itRequest.findFirstOrThrow()).toMatchObject({ kind: "ERROR", sourceType: "error", sourceId: id });
    expect((await openErrorFix(id, client, env)).opened).toBe(false);
    expect(await appDb.itRequest.count()).toBe(1);
  });

  it("stops after the attempt limit", async () => {
    const client = fakeClient();
    const id = await seed();
    for (let i = 0; i < 3; i++) {
      expect((await openErrorFix(id, client, env)).opened).toBe(true);
      await appDb.itRequest.updateMany({ where: { status: { notIn: ["CLOSED"] } }, data: { status: "CLOSED" } });
    }
    const fourth = await openErrorFix(id, client, env);
    expect(fourth.opened).toBe(false);
    expect(fourth.reason).toMatch(/Already tried 3/);
  });

  it("pauses when the last fixes all failed or were rejected", async () => {
    const client = fakeClient();
    for (const route of ["/a", "/b", "/c"]) {
      const eid = (await captureError(boom(), { ...input, route })).id!;
      await openErrorFix(eid, client, env);
      await appDb.itRequest.updateMany({ where: { sourceId: eid }, data: { status: "FAILED" } });
    }
    const next = (await captureError(boom(), { ...input, route: "/d" })).id!;
    expect(await openErrorFix(next, client, env)).toMatchObject({ opened: false, reason: expect.stringMatching(/paused/) });
  });

  it("reportError opens a fix once for a new error, not for a repeat, and not when switched off", async () => {
    vi.stubEnv("IT_AUTOFIX", "off");
    await reportError(boom(), input);
    expect(await appDb.itRequest.count()).toBe(0);

    vi.stubEnv("IT_AUTOFIX", "on");
    resetErrorThrottle();
    await appDb.errorEvent.deleteMany();
    await reportError(boom(), input); // new: a request is opened (AI Builder is not configured here, so it waits as SUBMITTED)
    expect(await appDb.itRequest.count()).toBe(1);
    resetErrorThrottle();
    await reportError(boom(), input); // repeat: nothing new
    expect(await appDb.itRequest.count()).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe("resolveErrorsFor", () => {
  it("marks an error fixed once, and only while it is open", async () => {
    const id = (await captureError(boom(), input)).id!;
    await resolveErrorsFor("IT-1001", id);
    const row = await appDb.errorEvent.findUniqueOrThrow({ where: { id } });
    expect(row.resolvedAt).not.toBeNull();
    const at = row.resolvedAt;
    await resolveErrorsFor("IT-1002", id, new Date(Date.now() + 1000));
    expect((await appDb.errorEvent.findUniqueOrThrow({ where: { id } })).resolvedAt).toEqual(at);
    await expect(resolveErrorsFor("IT-1003", null)).resolves.toBeUndefined();
  });
});
