/* eslint-disable @typescript-eslint/no-explicit-any -- fake fetch in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { buildClassifyPrompt } from "../src/domain/it";
import { appFrames, describePattern, describeRelease, excerptAround, gatherErrorContext } from "../src/domain/it/errorContext";
import { truncateAll } from "./helpers";

const NOW = new Date("2026-11-21T10:00:00Z");
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);
const STACK = [
  "TypeError: Cannot read properties of null (reading 'total')",
  "    at sumLines (/opt/render/project/src/src/domain/invoicing/calc.ts:42:7)",
  "    at /opt/render/project/src/node_modules/next/dist/server/app-render.js:10:3",
  "    at InvoicesPage (webpack-internal:///(rsc)/./app/invoices/page.tsx:18:20)",
  "    at sumLines (/opt/render/project/src/src/domain/invoicing/calc.ts:42:7)",
].join("\n");

describe("appFrames", () => {
  it("finds the app's own files and lines, skipping dependencies and repeats", () => {
    expect(appFrames(STACK, 2, "/opt/render/project/src")).toEqual([
      { file: "src/domain/invoicing/calc.ts", line: 42 },
      { file: "app/invoices/page.tsx", line: 18 },
    ]);
  });
  it("ignores stacks without app frames and paths that try to climb out", () => {
    expect(appFrames("Error: x\n    at f (node:internal/process:1:1)")).toEqual([]);
    expect(appFrames("Error: x\n    at f (/srv/src/../etc/passwd.ts:1:1)", 2, "/srv")).toEqual([]);
  });
});

describe("describePattern", () => {
  it("tells a burst from a single occurrence", () => {
    expect(describePattern({ buckets: [], total: 1, firstSeenAt: min(30), lastSeenAt: min(30), now: NOW })).toBe("It has happened once (first seen 30 minutes ago).");
    expect(describePattern({ buckets: [{ startsAt: min(10), count: 12 }], total: 12, firstSeenAt: min(12), lastSeenAt: min(9), now: NOW })).toBe(
      "12 times in the last hour and 12 in the last day, all within a few minutes; 12 times in all, first seen 12 minutes ago.",
    );
  });
  it("says when it has gone quiet", () => {
    expect(describePattern({ buckets: [], total: 4, firstSeenAt: min(3 * 24 * 60), lastSeenAt: min(2 * 24 * 60), now: NOW })).toBe(
      "4 times in all, none in the last day (first seen 3 days ago, last 2 days ago).",
    );
  });
});

describe("describeRelease", () => {
  it("flags an error that is new in the running release", () => {
    expect(describeRelease("abc1234def", "abc1234def", "abc1234def")).toBe("It first appeared in the release now running (abc1234): it is new since the last change.");
  });
  it("says when it predates the running release", () => {
    expect(describeRelease("aaa1111", "bbb2222", "bbb2222")).toBe("It first appeared in an earlier release (aaa1111) and still happens in the one now running (bbb2222).");
    expect(describeRelease(null, null, "bbb2222")).toBeNull();
  });
});

describe("excerptAround", () => {
  it("numbers the lines and marks the failing one", () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const out = excerptAround(text, 15, 2).split("\n");
    expect(out).toEqual([" 13 | line 13", " 14 | line 14", ">15 | line 15", " 16 | line 16", " 17 | line 17"]);
  });
});

describe("gatherErrorContext", () => {
  beforeEach(truncateAll);
  afterAll(async () => {
    await truncateAll();
    await appDb.$disconnect();
  });

  it("brings together how often, the release, recent changes and the code at the release", async () => {
    const err = await appDb.errorEvent.create({
      data: { fingerprint: "fp-ctx", name: "TypeError", message: "boom", stack: STACK, source: "request", route: "/invoices", firstRelease: "abc1234", lastRelease: "abc1234", count: 5, firstSeenAt: min(50), lastSeenAt: min(5) },
    });
    await appDb.errorBucket.create({ data: { errorId: err.id, startsAt: min(10), count: 5 } });
    await appDb.itRequest.create({ data: { number: "IT-77", kind: "FEATURE", title: "Show totals on invoices", description: "d", requestedByLabel: "Sam", status: "LIVE", liveAt: min(110) } as any });
    await appDb.itRequest.create({ data: { number: "IT-70", kind: "FEATURE", title: "Too old to matter", description: "d", requestedByLabel: "Sam", status: "LIVE", liveAt: min(5000) } as any });
    const fetchImpl = vi.fn(async (url: string) => ({ ok: true, text: async () => (url.includes("calc.ts") ? Array.from({ length: 50 }, (_, i) => `calc ${i + 1}`).join("\n") : "page") })) as unknown as typeof fetch;

    const ctx = await gatherErrorContext(err.id, { now: NOW, root: "/opt/render/project/src", env: { IT_SCAN_REPO: "acme/app", IT_SCAN_DISPATCH_TOKEN: "t", RENDER_GIT_COMMIT: "abc1234" }, fetchImpl });
    expect(ctx).toMatchObject({
      pattern: "5 times in the last hour and 5 in the last day, all within a few minutes; 5 times in all, first seen 50 minutes ago.",
      release: "It first appeared in the release now running (abc1234): it is new since the last change.",
      recentChanges: ["IT-77: Show totals on invoices (live 1 hour before it first appeared)"],
    });
    expect(ctx!.code.map((c) => [c.file, c.line])).toEqual([["src/domain/invoicing/calc.ts", 42], ["app/invoices/page.tsx", 18]]);
    expect(ctx!.code[0]!.excerpt).toContain(">42 | calc 42");
    expect((fetchImpl as any).mock.calls[0][0]).toBe("https://api.github.com/repos/acme/app/contents/src/domain/invoicing/calc.ts?ref=abc1234");

    const prompt = buildClassifyPrompt({ name: err.name, message: err.message, stack: err.stack, context: ctx });
    expect(prompt).toContain("release: It first appeared in the release now running");
    expect(prompt).toContain("- IT-77: Show totals on invoices");
    expect(prompt).toContain("code at that release, src/domain/invoicing/calc.ts around line 42:");
    expect(prompt.trim().endsWith('"""')).toBe(true);
  });

  it("leaves the code out without a repo or when GitHub fails, and never throws", async () => {
    const err = await appDb.errorEvent.create({ data: { fingerprint: "fp-ctx2", name: "Error", message: "x", stack: STACK, source: "request", firstRelease: "abc1234", lastRelease: "abc1234" } });
    expect((await gatherErrorContext(err.id, { now: NOW, env: {} }))!.code).toEqual([]);
    const failing = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await gatherErrorContext(err.id, { now: NOW, env: { IT_SCAN_REPO: "acme/app" }, fetchImpl: failing }))!.code).toEqual([]);
    expect(await gatherErrorContext("missing", { now: NOW })).toBeNull();
  });
});
