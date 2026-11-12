/* eslint-disable @typescript-eslint/no-explicit-any -- loose AI Builder events and a fake client in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { buildFixSummary, captureError, createItRequest, firstSentences, getFixSummary, looksPlain, pageLabel, protectedAreas, resetErrorThrottle, startItRequest, whereLabel, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

const T0 = new Date("2026-11-06T10:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000).toISOString();
const error = { route: "/quotes", source: "request", count: 14, resolvedAt: null as Date | null };
const req = (over: Record<string, unknown> = {}) => ({ status: "BUILDING" as any, liveAt: null as Date | null, previewUrl: null as string | null, title: "The Quotes list showed an error", ...over });

describe("plain wording", () => {
  it("names where it happened the way a person would", () => {
    expect(pageLabel("/quotes")).toBe("The Quotes list");
    expect(pageLabel("/quotes/[id]")).toBe("A quote page");
    expect(pageLabel("/invoices")).toBe("The Invoices list");
    expect(pageLabel("/api/something")).toBe("A background part of the app");
    expect(pageLabel("/zzz")).toBe("A page in the app");
    expect(pageLabel(null)).toBe("Part of the app");
    expect(whereLabel("/quotes", "workflow")).toBe("A background task");
  });

  it("accepts plain sentences and rejects anything that mentions code", () => {
    expect(looksPlain("Sent quotes now show how many days they have left.")).toBe(true);
    for (const bad of [
      "Fixed a null check in validityNote",
      "Updated src/domain/quotes/validity.ts",
      "Guarded `decidedAt` before reading it",
      "The TypeError came from the function",
      "Merged the branch and opened a pull request",
      "See https://github.com/o/r/pull/3",
      "Added a regression test in validity.test.ts",
      "Short",
    ]) expect(looksPlain(bad), bad).toBe(false);
    expect(looksPlain(null)).toBe(false);
  });

  it("cuts long text at a sentence end", () => {
    const text = `${"A short sentence. ".repeat(30)}`;
    const out = firstSentences(text, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".")).toBe(true);
  });

  it("names the area a developer must review, never the file", () => {
    expect(protectedAreas(["src/access.ts", "src/guard.ts", "prisma/migrations/x/migration.sql"])).toEqual(["Database migrations and schema", "Sign-in and permissions"]);
  });
});

describe("buildFixSummary", () => {
  const ready = [
    { type: "spec_ready", at: at(1), version: 1, spec: { summary: "Sent quotes will show how many days they have left instead of failing." } },
    { type: "command_run", at: at(5), name: "test", exitCode: 0, output: "ok" },
    { type: "ci_status", at: at(7), sha: "a", state: "success", checks: [{ name: "verify", state: "success" }] },
    { type: "preview_ready", at: at(8), sha: "a", url: "https://preview.example/pr-3" },
  ];

  it("says what went wrong, what happens now and the proof, once a fix is ready to try", () => {
    const s = buildFixSummary({ error, request: req({ status: "PR_OPEN", previewUrl: "https://preview.example/pr-3" }), events: ready, since: null });
    expect(s.before).toBe("The Quotes list showed an error.");
    expect(s.after).toBe("Sent quotes will show how many days they have left instead of failing.");
    expect(s.checks).toEqual([
      { label: "Tested automatically", state: "ok" },
      { label: "Automatic checks passed", state: "ok" },
      { label: "Preview ready to try", state: "ok" },
    ]);
    expect(s.counts).toBe("Happened 14 times so far.");
    expect(s.previewUrl).toBe("https://preview.example/pr-3");
  });

  it("shows the error count before and since it went live", () => {
    const live = req({ status: "LIVE", liveAt: T0 });
    expect(buildFixSummary({ error, request: live, events: [], since: 0 }).counts).toBe("Happened 14 times before the fix. Not once since it went live.");
    expect(buildFixSummary({ error, request: live, events: [], since: 3 }).counts).toBe("Happened 11 times before the fix, and 3 times since it went live.");
    expect(buildFixSummary({ error: { ...error, count: 1 }, request: live, events: [], since: 0 }).counts).toBe("Happened once before the fix. Not once since it went live.");
  });

  it("does not present a proposed plan as what happens now", () => {
    const s = buildFixSummary({ error, request: req({ status: "SPEC_REVIEW" }), events: [ready[0]!], since: null });
    expect(s.after).toMatch(/^Planned: /);
  });

  it("falls back to a generic sentence when the assistant's words mention code", () => {
    const technical = [{ type: "assistant_message", at: at(2), text: "I guarded decidedAt in src/domain/quotes/validity.ts and added a regression test." }];
    expect(buildFixSummary({ error, request: req({ status: "PR_OPEN" }), events: technical, since: null }).after).toBe("A fix is ready for you to try.");
    expect(buildFixSummary({ error, request: req({ status: "LIVE", liveAt: T0 }), events: technical, since: 0 }).after).toBe("The problem has been fixed.");
    expect(buildFixSummary({ error, request: req({ status: "BUILDING" }), events: technical, since: null }).after).toBeNull();
  });

  it("shows failed checks without saying which", () => {
    const s = buildFixSummary({ error, request: req(), events: [{ type: "command_run", at: at(1), name: "test", exitCode: 1, output: "FAIL validity.test.ts" }, { type: "ci_status", at: at(2), sha: "a", state: "failure", checks: [{ name: "verify", state: "failure" }] }], since: null });
    expect(s.checks).toEqual([{ label: "Automatic tests found a problem", state: "bad" }, { label: "Automatic checks found a problem", state: "bad" }]);
    expect(JSON.stringify(s)).not.toMatch(/validity|verify|FAIL/);
  });

  it("works when the session cannot be read, or there is no captured error", () => {
    expect(buildFixSummary({ error, request: req(), events: null, since: null }).checks).toEqual([]);
    expect(buildFixSummary({ error: null, request: req({ title: "Deploy failed after IT-1000" }), events: null, since: null }).before).toBe("Something in the app was not working.");
  });

  it("never contains a link to the code, a file name or a test name", () => {
    const events = [...ready, { type: "pr_opened", at: at(6), number: 3, url: "https://github.com/o/r/pull/3" }, { type: "commit_pushed", at: at(4), message: "Fix validity", files: ["src/domain/quotes/validity.ts", "test/validity.test.ts"] }];
    const json = JSON.stringify(buildFixSummary({ error, request: req({ status: "PR_OPEN", previewUrl: "https://preview.example/pr-3" }), events, since: null }));
    expect(json).not.toMatch(/github\.com|\/pull\/|validity|\.test\.|src\/|pull request/i);
  });
});

describe("getFixSummary", () => {
  beforeEach(async () => {
    resetErrorThrottle();
    await truncateAll();
  });
  afterAll(async () => {
    await truncateAll();
    await appDb.$disconnect();
  });

  const boom = () => Object.assign(new TypeError("Cannot read properties of null (reading 'getTime')"), { stack: "TypeError: x\n    at validityNote (/app/a.js:1:1)" });
  const client = (events: any[], fail = false) =>
    ({
      createSession: vi.fn(async () => ({ id: `fs-${Math.random()}`, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null })),
      getSession: vi.fn(async (id: string) => {
        if (fail) throw new Error("builder down");
        return { session: { id, appId: "i", intent: "bugfix", title: "t", status: "pr_open", costUsd: 0, prUrl: null }, events, acceptance: null };
      }),
    }) as unknown as AiBuilderClient;

  async function open(c: AiBuilderClient) {
    const errId = (await captureError(boom(), { source: "request", route: "/quotes", now: T0 })).id!;
    const { request } = await createItRequest({ kind: "ERROR", intent: "bugfix", title: "The Quotes list showed an error", description: "d", sourceType: "error", sourceId: errId }, { actor: { type: "SYSTEM", label: "t" } });
    return { errId, request: (await startItRequest(request.id, c)).request };
  }

  it("joins the error, the request and the session", async () => {
    const c = client([{ type: "command_run", at: at(1), name: "test", exitCode: 0, output: "" }]);
    const { request } = await open(c);
    const s = await getFixSummary(request.id, c);
    expect(s.before).toBe("The Quotes list showed an error.");
    expect(s.checks).toEqual([{ label: "Tested automatically", state: "ok" }]);
    expect(s.counts).toBe("Happened once so far.");
  });

  it("counts what happened since it went live from the error buckets", async () => {
    const c = client([]);
    const { errId, request } = await open(c);
    await appDb.itRequest.update({ where: { id: request.id }, data: { status: "LIVE", liveAt: T0 } });
    await appDb.errorEvent.update({ where: { id: errId }, data: { count: 10 } });
    await appDb.errorBucket.deleteMany();
    await appDb.errorBucket.create({ data: { errorId: errId, startsAt: new Date(T0.getTime() + 10 * 60_000), count: 2 } });
    const s = await getFixSummary(request.id, c);
    expect(s.counts).toBe("Happened 8 times before the fix, and 2 times since it went live.");
    expect(s.after).toBe("The problem has been fixed.");
  });

  it("still answers when AI Builder is unreachable", async () => {
    const { request } = await open(client([]));
    const s = await getFixSummary(request.id, client([], true));
    expect(s.before).toBe("The Quotes list showed an error.");
    expect(s.checks).toEqual([]);
  });
});
