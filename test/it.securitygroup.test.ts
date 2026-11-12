/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { compareVersions, dismissFinding, highestVersion, ingestScan, listFailedFixes, openFindingFix, openNextFindingFix, queuedFindingCount, retryFindingFix, triageScan, type AiBuilderClient, type Responder } from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Dave Owner" }, userId: "u1", email: "dave@example.test", name: "Dave Owner", roles: ["ADMIN"] };
let seq = 0;
const dep = (pkg: string, fixedIn: string | null, over: Record<string, unknown> = {}) => ({
  tool: "osv", ruleId: `GHSA-${String(++seq).padStart(4, "0")}`, severity: "HIGH", file: "pnpm-lock.yaml", line: null, message: `${pkg}@7.30.0: Problem ${seq}${fixedIn ? ` (fixed in ${fixedIn})` : ""}`, fixedIn, fingerprint: `osv:g${String(seq).padStart(6, "0")}:${pkg.replace(/\W/g, "_")}`, ...over,
});
const scan = (scanId: string, findings: unknown[]) => ({ scanId, kind: "weekly", tools: ["osv", "pnpm-audit", "semgrep"], findings });
let n = 0;
const client = () =>
  ({
    createSession: vi.fn(async () => ({ id: `g-${++n}`, appId: "i", intent: "maintenance", title: "t", status: "working", costUsd: 0, prUrl: null })),
    cancel: vi.fn(async () => undefined),
    getSession: vi.fn(async (id: string) => ({ session: { id, appId: "i", intent: "maintenance", title: "t", status: "closed", costUsd: 0, prUrl: null }, events: [], acceptance: null })),
  }) as unknown as AiBuilderClient;

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("versions", () => {
  it("picks the highest patched version and ignores what is not a plain version", () => {
    expect(highestVersion(["7.31.0", "7.30.9", null, "7.31.10", "nonsense"])).toBe("7.31.10");
    expect(highestVersion([null, undefined])).toBeNull();
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
  });
});

describe("one fix per package", () => {
  it("clears several advisories against one package with a single request to the highest patched version", async () => {
    await ingestScan(scan("s1", [dep("undici", "7.31.0"), dep("undici", "7.32.1", { severity: "CRITICAL" }), dep("undici", "7.31.5"), dep("zod", "3.25.77")]));
    const c = client();
    const r = await triageScan("s1", c, {});
    expect(r).toMatchObject({ opened: 1, queued: 1 }); // undici (three advisories) now, zod waiting
    const req = await appDb.itRequest.findFirstOrThrow();
    expect(req.title).toBe("Security: undici: 3 advisories");
    const input = (c.createSession as any).mock.calls[0][0];
    expect(input.text).toContain("patched version: 7.32.1");
    expect(input.text).toMatch(/clear all of these advisories for undici/);
    expect(input.text).toContain("GHSA-");
    expect(input.context.findings).toHaveLength(3);
    const undici = await appDb.finding.findMany({ where: { message: { startsWith: "undici@" } } });
    expect(undici.every((f) => f.status === "FIXING" && f.itRequestId === req.id)).toBe(true);
    expect((await appDb.finding.findFirstOrThrow({ where: { message: { startsWith: "zod@" } } })).status).toBe("OPEN");
  });

  it("files the request under the worst advisory", async () => {
    await ingestScan(scan("s1", [dep("undici", "7.31.0"), dep("undici", "7.32.1", { severity: "CRITICAL" })]));
    await openNextFindingFix(client(), {});
    const worst = await appDb.finding.findFirstOrThrow({ where: { severity: "CRITICAL" } });
    expect((await appDb.itRequest.findFirstOrThrow()).sourceId).toBe(worst.id);
  });

  it("groups osv and pnpm audit findings for the same package, but never different packages or code findings", async () => {
    await ingestScan(scan("s1", [
      dep("undici", "7.31.0"),
      { ...dep("undici", "7.31.2"), tool: "pnpm-audit", message: "undici: Another problem (fixed in 7.31.2)", fingerprint: "pnpm-audit:GHSA-x:undici" },
      dep("tinypool", "2.1.2"),
      { tool: "semgrep", ruleId: "r", severity: "HIGH", file: "src/a.ts", line: 3, message: "Unsafe thing", fingerprint: "semgrep:r:aaaaaaaaaaaa:1" },
      { tool: "semgrep", ruleId: "r", severity: "HIGH", file: "src/b.ts", line: 3, message: "Unsafe thing", fingerprint: "semgrep:r:bbbbbbbbbbbb:1" },
    ]));
    expect(await queuedFindingCount()).toBe(4); // undici (2 advisories), tinypool, and two separate code fixes
  });

  it("has no version to name when none of the advisories names one, and says so", async () => {
    await ingestScan(scan("s1", [dep("undici", null), dep("undici", null)]));
    const c = client();
    await openNextFindingFix(c, {});
    expect((c.createSession as any).mock.calls[0][0].text).toContain("If you cannot tell which version is patched, say so and change nothing");
  });

  it("opens the same group when asked about any one of its findings", async () => {
    await ingestScan(scan("s1", [dep("undici", "7.31.0"), dep("undici", "7.32.1")]));
    const one = await appDb.finding.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    expect((await openFindingFix(one.id, client(), {})).opened).toBe(true);
    expect(await appDb.itRequest.count()).toBe(1);
    expect(await appDb.finding.count({ where: { status: "FIXING" } })).toBe(2);
  });
});

describe("a group that fails or is dismissed in part", () => {
  const failedGroup = async () => {
    await ingestScan(scan("s1", [dep("undici", "7.31.0"), dep("undici", "7.32.1"), dep("undici", "7.31.5")]));
    const c = client();
    await openNextFindingFix(c, {});
    await appDb.itRequest.updateMany({ data: { status: "BUILD_FAILED" } });
    return c;
  };

  it("retries every finding of the group together, with one new request", async () => {
    const c = await failedGroup();
    const failed = await listFailedFixes();
    expect(failed).toHaveLength(3);
    const r = await retryFindingFix(failed[0]!.findingId, owner, c, {});
    expect(r.opened).toBe(true);
    expect(await appDb.itRequest.count()).toBe(2);
    expect(await appDb.finding.count({ where: { status: "FIXING", itRequestId: r.requestId } })).toBe(3);
    expect(await listFailedFixes()).toHaveLength(0);
  });

  it("keeps the fix going when one advisory of the group is dismissed, and calls it off with the last", async () => {
    await ingestScan(scan("s1", [dep("undici", "7.31.0"), dep("undici", "7.32.1")]));
    const c = client();
    await openNextFindingFix(c, {});
    const [a, b] = await appDb.finding.findMany({ orderBy: { createdAt: "asc" } });
    await dismissFinding({ id: a!.id, status: "FALSE_POSITIVE" }, owner, c);
    expect((c as any).cancel).not.toHaveBeenCalled();
    expect((await appDb.itRequest.findFirstOrThrow()).status).not.toBe("CLOSED");
    await dismissFinding({ id: b!.id, status: "ACCEPTED_RISK", reason: "Not reachable" }, owner, c);
    expect((c as any).cancel).toHaveBeenCalledTimes(1);
  });
});
