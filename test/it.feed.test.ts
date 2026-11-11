/* eslint-disable @typescript-eslint/no-explicit-any -- AI Builder events are loose JSON in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { buildFeed, captureError, getItFeed, resetErrorThrottle, submitItRequest, type AiBuilderClient, type FeedAttempt } from "../src/domain/it";
import { truncateAll } from "./helpers";

const T = (m: number) => new Date(Date.UTC(2026, 10, 6, 10, m));
const at = (m: number) => T(m).toISOString();
const error = { firstSeenAt: T(0), message: "Cannot read properties of null (reading 'getTime')", route: "/quotes", count: 4, resolvedAt: null as Date | null, regressions: 0, source: "request" };
const reqRow = (over: Record<string, unknown> = {}) => ({ number: "IT-1001", status: "BUILDING" as any, createdAt: T(1), updatedAt: T(1), mergedAt: null, deployError: null, prUrl: null, previewUrl: null, ...over });
const attempt = (events: any[] | null, over: Record<string, unknown> = {}): FeedAttempt => ({ request: reqRow(over), events });

const fullRun = [
  { type: "build_started", at: at(2), iteration: 1, branch: "ai/x", base: "staging", trigger: "spec" },
  { type: "commit_pushed", at: at(5), sha: "a1", message: "Fix validityNote for sent quotes", files: ["src/domain/quotes/validity.ts", "test/validity.test.ts"] },
  { type: "command_run", at: at(6), name: "test", command: "pnpm test", exitCode: 0, durationMs: 1000, output: "ok" },
  { type: "command_run", at: at(6), name: "build", command: "pnpm build", exitCode: 0, durationMs: 1000, output: "" },
  { type: "pr_opened", at: at(7), number: 42, url: "https://github.com/o/r/pull/42", base: "staging", head: "ai/x" },
  { type: "ci_status", at: at(8), sha: "a1", state: "pending", checks: [] },
  { type: "ci_status", at: at(9), sha: "a1", state: "success", checks: [] },
  { type: "preview_ready", at: at(10), sha: "a1", url: "https://preview.example/pr-42" },
  { type: "accepted", at: at(12), sha: "a1", mode: "owner" },
  { type: "pr_closed", at: at(13), number: 42, url: "https://github.com/o/r/pull/42", merged: true },
];

describe("buildFeed", () => {
  it("tells the whole story in order, from detected to confirmed fixed", () => {
    const feed = buildFeed({ error: { ...error, resolvedAt: T(20) }, reopenedAt: [], attempts: [attempt(fullRun, { status: "LIVE", mergedAt: T(13) })] });
    expect(feed.map((f) => f.text)).toEqual([
      "The Quotes list showed an error",
      "Assistant asked to fix it",
      "Fix started",
      "Checked it can't happen again",
      "Fix prepared",
      "Tested automatically: passed",
      "Fix ready for review",
      "Automatic checks passed",
      "Preview ready - try it",
      "Accepted",
      "Put into the app",
      "Fix is live - watching for a repeat",
    ]);
    expect(feed[0]!.detail).toBe("Happened 4 times so far");
  });

  it("orders dated lines by time and puts untimed 'where it stands' lines last", () => {
    const feed = buildFeed({ error, reopenedAt: [], attempts: [attempt(fullRun.slice(0, 7), { status: "BUILDING" })] });
    const times = feed.filter((f) => f.at).map((f) => f.at!.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(feed.at(-1)).toMatchObject({ at: null, text: "The assistant is working on it", tone: "wait" });
  });

  it("does not call a non-test commit a safeguard, and says so only once", () => {
    const feed = buildFeed({ error, reopenedAt: [], attempts: [attempt([{ type: "commit_pushed", at: at(3), message: "m", files: ["src/a.ts"] }, { type: "commit_pushed", at: at(4), message: "m", files: ["test/a.test.ts"] }, { type: "commit_pushed", at: at(5), message: "m", files: ["test/b.test.ts"] }])] });
    expect(feed.filter((f) => f.text === "Checked it can't happen again")).toHaveLength(1);
    expect(feed.filter((f) => f.text === "Fix prepared")).toHaveLength(1);
  });

  it("shows problems with tests and checks without any of their detail, and ignores pending CI, other commands and base updates", () => {
    const feed = buildFeed({
      error,
      reopenedAt: [],
      attempts: [attempt([
        { type: "command_run", at: at(3), name: "test", exitCode: 1, output: "line1\nFAIL validity.test.ts\n1 failed" },
        { type: "command_run", at: at(3), name: "lint", exitCode: 1, output: "x" },
        { type: "ci_status", at: at(4), sha: "s", state: "pending", checks: [] },
        { type: "ci_status", at: at(5), sha: "s", state: "failure", checks: [{ name: "verify", state: "failure" }, { name: "x", state: "success" }] },
        { type: "ci_status", at: at(5), sha: "s", state: "failure", checks: [] },
        { type: "commit_pushed", at: at(6), message: "merge", files: ["a.ts"], reason: "base_update" },
      ])],
    });
    const text = feed.map((f) => f.text);
    expect(text).toContain("Tested automatically: found a problem");
    expect(text.filter((t) => t === "Automatic checks found a problem")).toHaveLength(1);
    expect(text).not.toContain("Fix prepared");
    expect(JSON.stringify(feed)).not.toMatch(/validity\.test|FAIL|verify|lint/);
  });

  it("labels each attempt when there is more than one, and shows a return after a fix", () => {
    const feed = buildFeed({
      error: { ...error, regressions: 1 },
      reopenedAt: [T(30)],
      attempts: [attempt([], { number: "IT-1001", status: "LIVE", createdAt: T(1) }), attempt([{ type: "build_started", at: at(41), iteration: 1 }], { number: "IT-1002", status: "BUILDING", createdAt: T(40) })],
    });
    expect(feed.find((f) => f.text === "The error came back after its fix")).toBeTruthy();
    expect(feed.filter((f) => f.text.startsWith("Attempt")).map((f) => f.request)).toEqual(["IT-1001", "IT-1002"]);
    expect(feed.at(-1)).toMatchObject({ request: "IT-1002", tone: "wait" });
  });

  it("says what it waits for, and when the deploy failed", () => {
    const wait = buildFeed({ error, reopenedAt: [], attempts: [attempt([], { status: "PR_OPEN" })] });
    expect(wait.at(-1)!.text).toBe("Getting the change ready to try");
    const ready = buildFeed({ error, reopenedAt: [], attempts: [{ ...attempt(fullRun.slice(0, 9), { status: "PR_OPEN" }), acceptance: { ready: true } }] });
    expect(ready.at(-1)!.text).toBe("Waiting for someone to try the change and accept it");
    const failed = buildFeed({ error, reopenedAt: [], attempts: [attempt([], { status: "DEPLOY_FAILED", deployError: "The ironbark-web deploy ended as build failed." })] });
    expect(failed.map((f) => f.text)).toContain("The fix did not start up properly");
    expect(failed.at(-1)!.text).toBe("Needs a developer to take a look");
  });

  it("does not say someone can try the change while the automatic checks are still running", () => {
    const upToCi = fullRun.slice(0, 6); // ... pr_opened, ci pending
    const running = buildFeed({ error, reopenedAt: [], attempts: [{ ...attempt(upToCi, { status: "PR_OPEN" }), acceptance: { ready: false } }] });
    expect(running.at(-1)).toMatchObject({ tone: "wait", text: "Automatic checks are running - the change can be tried once they pass" });
    const noPreview = buildFeed({ error, reopenedAt: [], attempts: [{ ...attempt(fullRun.slice(0, 7), { status: "PR_OPEN" }), acceptance: { ready: false } }] });
    expect(noPreview.at(-1)!.text).toBe("Automatic checks passed - waiting for the preview to be ready to try");
    const failing = [...upToCi, { type: "ci_status", at: at(9), sha: "a1", state: "failure", checks: [] }];
    const failed = buildFeed({ error, reopenedAt: [], attempts: [{ ...attempt(failing, { status: "PR_OPEN" }), acceptance: { ready: false } }] });
    expect(failed.at(-1)!.text).toBe("Automatic checks found a problem - the assistant is looking at it");
    const waiting = buildFeed({ error, reopenedAt: [], attempts: [{ ...attempt(fullRun.slice(0, 9), { status: "PR_OPEN" }), acceptance: { ready: true } }] });
    expect(waiting.at(-1)!.text).toBe("Waiting for someone to try the change and accept it");
  });

  it("still tells the story when the session cannot be read", () => {
    const feed = buildFeed({ error, reopenedAt: [], attempts: [attempt(null)] });
    expect(feed.map((f) => f.text)).toEqual(["The Quotes list showed an error", "Assistant asked to fix it", "The assistant is working on it"]);
  });

  it("never shows the assistant's own error text, which can be technical", () => {
    const feed = buildFeed({ error, reopenedAt: [], attempts: [attempt([{ type: "error", at: at(3), message: "TypeError at src/domain/x.ts:10 " + "x".repeat(5000) }])] });
    const line = feed.find((f) => f.text === "The assistant hit a problem")!;
    expect(line.detail).toBeUndefined();
  });

  it("shows no code, file names, error messages or links to the code anywhere", () => {
    const feed = buildFeed({
      error: { ...error, resolvedAt: T(20), classification: "code_bug", classConfidence: "high", classReason: "A TypeError from our own code in validity.ts" },
      reopenedAt: [],
      attempts: [attempt([...fullRun, { type: "error", at: at(11), message: "boom in src/x.ts" }], { status: "LIVE", mergedAt: T(13), needsDeveloper: true, protectedFiles: ["src/access.ts", "prisma/migrations/x/migration.sql"], deployError: "build failed" })],
    });
    const json = JSON.stringify(feed);
    expect(json).not.toMatch(/github\.com|\/pull\/|validity\.ts|\.test\.|src\/|prisma\/|Cannot read|TypeError|#42|pull request|commit|CI /i);
    expect(feed.every((f) => !f.url || f.url.startsWith("https://preview."))).toBe(true);
    expect(feed.find((f) => f.text === "A developer must review it first")!.detail).toBe("Database migrations and schema, Sign-in and permissions");
  });

  it("works without a captured error, from the request alone", () => {
    const feed = buildFeed({ error: null, reopenedAt: [], attempts: [attempt([])], fallbackTitle: "Deploy failed after IT-1000" });
    expect(feed[0]).toMatchObject({ text: "A problem was reported" });
    expect(feed[0]!.detail).toBeUndefined();
  });
});

describe("getItFeed", () => {
  beforeEach(async () => {
    resetErrorThrottle();
    await truncateAll();
  });
  afterAll(async () => {
    await truncateAll();
    await appDb.$disconnect();
  });

  const boom = () => Object.assign(new TypeError("x is null"), { stack: "TypeError: x is null\n    at validityNote (/app/a.js:1:1)" });
  const client = (events: any[], fail = false) =>
    ({
      createSession: vi.fn(async () => ({ id: `feed-${Math.random()}`, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null })),
      getSession: vi.fn(async (id: string) => {
        if (fail) throw new Error("builder down");
        return { session: { id, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null }, events, acceptance: null };
      }),
    }) as unknown as AiBuilderClient;

  const open = async (c: AiBuilderClient) => {
    // Fixed time, earlier than the session events, so the test does not depend on the clock it runs at.
    const { id } = (await captureError(boom(), { source: "request", route: "/quotes", now: T(-5) })) as { id: string };
    const { request } = await submitItRequest({ kind: "ERROR", intent: "bugfix", title: "Error on /quotes", description: "d", sourceType: "error", sourceId: id }, { actor: { type: "SYSTEM", label: "IT assistant" } }, c);
    return { errorId: id, request };
  };

  it("joins the captured error, the request and the session's events", async () => {
    const c = client(fullRun);
    const { request } = await open(c);
    const feed = await getItFeed(request.id, c);
    const text = feed.map((f) => f.text);
    expect(text[0]).toBe("The Quotes list showed an error");
    expect(text).toEqual(expect.arrayContaining(["Assistant asked to fix it", "Checked it can't happen again", "Automatic checks passed", "Preview ready - try it", "Put into the app"]));
  });

  it("includes every attempt for the same error, whichever one is opened", async () => {
    const c = client([]);
    const { errorId, request } = await open(c);
    await appDb.itRequest.update({ where: { id: request.id }, data: { status: "CLOSED" } });
    const second = await submitItRequest({ kind: "ERROR", intent: "bugfix", title: "again", description: "d", sourceType: "error", sourceId: errorId }, { actor: { type: "SYSTEM", label: "IT assistant" } }, c);
    const feed = await getItFeed(second.request.id, c);
    expect(feed.filter((f) => f.text.startsWith("Attempt"))).toHaveLength(2);
  });

  it("still returns the story when AI Builder is unreachable", async () => {
    const { request } = await open(client([]));
    const feed = await getItFeed(request.id, client([], true));
    expect(feed.map((f) => f.text)).toContain("Assistant asked to fix it");
  });

  it("works for a request that did not come from a captured error", async () => {
    const c = client([]);
    const { request } = await submitItRequest({ kind: "ERROR", title: "Deploy failed after IT-1000", description: "d", sourceType: "deploy", sourceId: "x" }, { actor: { type: "SYSTEM", label: "IT assistant" } }, c);
    expect((await getItFeed(request.id, c))[0]).toMatchObject({ text: "A problem was reported" });
  });
});
