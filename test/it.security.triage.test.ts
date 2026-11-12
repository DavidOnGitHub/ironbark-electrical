/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { decideFinding, ingestScan, MAX_FIXES_PER_SCAN, openFindingFix, securityFixEnabled, triageScan, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

// Security fixes do not need IT_AUTOFIX: an empty environment is the normal case.
const on = {};
const f = (over: Record<string, unknown> = {}) => ({ tool: "semgrep", ruleId: "r", severity: "HIGH", file: "src/a.ts", line: 1, message: "Unsafe thing", fingerprint: `semgrep:r:${Math.random().toString(36).slice(2, 12)}`, ...over });
const scan = (scanId: string, findings: unknown[], tools = ["semgrep", "osv", "gitleaks"]) => ({ scanId, kind: "weekly", tools, findings });
const client = () =>
  ({
    createSession: vi.fn(async () => ({ id: `s-${Math.random()}`, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null })),
    getSession: vi.fn(),
  }) as unknown as AiBuilderClient;

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("decideFinding", () => {
  const base = { tool: "semgrep", severity: "HIGH" as any, source: "scan", status: "OPEN" as any, itRequestId: null };
  it("fixes high and critical code findings and dependency findings", () => {
    expect(decideFinding(base)).toMatchObject({ action: "fix", intent: "bugfix" });
    expect(decideFinding({ ...base, severity: "CRITICAL" })).toMatchObject({ action: "fix", intent: "bugfix" });
    expect(decideFinding({ ...base, tool: "osv" })).toMatchObject({ action: "fix", intent: "maintenance" });
    expect(decideFinding({ ...base, tool: "pnpm-audit" })).toMatchObject({ action: "fix", intent: "maintenance" });
  });
  it("only reports lower severities, leaked secrets and AI review findings", () => {
    expect(decideFinding({ ...base, severity: "MEDIUM" }).action).toBe("report");
    expect(decideFinding({ ...base, tool: "gitleaks" }).action).toBe("report");
    expect(decideFinding({ ...base, source: "ai-review" }).action).toBe("report");
  });
  it("leaves a finding that is closed or already has a request", () => {
    expect(decideFinding({ ...base, status: "FIXED" as any }).action).toBe("skip");
    expect(decideFinding({ ...base, itRequestId: "x" }).action).toBe("skip");
  });
});

describe("openFindingFix and triageScan", () => {
  it("opens a fix whatever IT_AUTOFIX says, because it is a separate switch", async () => {
    expect(securityFixEnabled({})).toBe(true);
    expect(securityFixEnabled({ IT_AUTOFIX: "off" })).toBe(true);
    await ingestScan(scan("s1", [f()]));
    const row = await appDb.finding.findFirstOrThrow();
    expect((await openFindingFix(row.id, client(), { IT_AUTOFIX: "off" })).opened).toBe(true);
  });

  it("does nothing while IT_SECURITY_AUTOFIX is off", async () => {
    for (const v of ["off", " OFF "]) expect(securityFixEnabled({ IT_SECURITY_AUTOFIX: v })).toBe(false);
    expect(securityFixEnabled({ IT_SECURITY_AUTOFIX: "on" })).toBe(true);
    await ingestScan(scan("s1", [f()]));
    const row = await appDb.finding.findFirstOrThrow();
    expect(await openFindingFix(row.id, client(), { IT_SECURITY_AUTOFIX: "off" })).toEqual({ opened: false, reason: "Security fixes are switched off" });
    expect(await appDb.itRequest.count()).toBe(0);
    expect((await triageScan("s1", client(), { IT_SECURITY_AUTOFIX: "off" })).opened).toBe(0);
  });

  it("opens a bugfix request, links it, and marks the finding as being fixed", async () => {
    await ingestScan(scan("s1", [f()]));
    const row = await appDb.finding.findFirstOrThrow();
    const c = client();
    const r = await openFindingFix(row.id, c, on);
    expect(r.opened).toBe(true);
    const req = await appDb.itRequest.findFirstOrThrow();
    expect(req).toMatchObject({ kind: "FINDING", intent: "bugfix", sourceType: "finding", sourceId: row.id });
    expect(await appDb.finding.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "FIXING", itRequestId: req.id });
    expect((c.createSession as any).mock.calls[0][0].context.finding).toMatchObject({ tool: "semgrep", severity: "HIGH" });
  });

  it("opens a maintenance request for a vulnerable dependency", async () => {
    await ingestScan(scan("s1", [f({ tool: "osv", fingerprint: "osv:GHSA-1:lodash" })]));
    await openFindingFix((await appDb.finding.findFirstOrThrow()).id, client(), on);
    expect(await appDb.itRequest.findFirstOrThrow()).toMatchObject({ intent: "maintenance" });
  });

  it("opens the worst few from one scan, most severe first, and leaves the rest for the next", async () => {
    const many = Array.from({ length: MAX_FIXES_PER_SCAN + 2 }, (_, i) => f({ severity: i === 0 ? "CRITICAL" : "HIGH", message: `Problem ${i}` }));
    await ingestScan(scan("s1", [...many, f({ severity: "LOW" }), f({ tool: "gitleaks", severity: "CRITICAL" })]));
    const r = await triageScan("s1", client(), on);
    expect(r).toMatchObject({ opened: MAX_FIXES_PER_SCAN, skippedByLimit: 2, reported: 2 });
    expect((await appDb.finding.findFirstOrThrow({ where: { message: "Problem 0" } })).status).toBe("FIXING");
    // The next scan picks up the ones that were left.
    await ingestScan(scan("s2", many));
    const next = await triageScan("s2", client(), on);
    expect(next.opened).toBe(2);
  });

  it("does not open a second request for a finding that already has one", async () => {
    await ingestScan(scan("s1", [f()]));
    const id = (await appDb.finding.findFirstOrThrow()).id;
    await openFindingFix(id, client(), on);
    expect((await openFindingFix(id, client(), on)).opened).toBe(false);
    expect(await appDb.itRequest.count()).toBe(1);
  });
});
