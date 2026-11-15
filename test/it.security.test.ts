import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { ingestScan, signScan, verifyScanSignature } from "../src/domain/it";
import { truncateAll } from "./helpers";

const finding = (over: Record<string, unknown> = {}) => ({
  tool: "osv", ruleId: "GHSA-aaaa-bbbb-cccc", severity: "HIGH", file: "pnpm-lock.yaml", line: 10, message: "lodash prototype pollution", fingerprint: "osv:GHSA-aaaa-bbbb-cccc:lodash", ...over,
});
const scan = (scanId: string, findings: unknown[], tools = ["osv"]) => ({ scanId, kind: "weekly", tools, findings });

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("ingestScan", () => {
  it("creates a finding and records the scan", async () => {
    const r = await ingestScan(scan("s1", [finding()]));
    expect(r).toMatchObject({ duplicate: false, created: 1, updated: 0, fixed: 0, total: 1 });
    const row = await appDb.finding.findUniqueOrThrow({ where: { fingerprint: "osv:GHSA-aaaa-bbbb-cccc:lodash" } });
    expect(row).toMatchObject({ status: "OPEN", severity: "HIGH", seenCount: 1, firstScanId: "s1", lastScanId: "s1" });
    expect((await appDb.securityScan.findUniqueOrThrow({ where: { id: "s1" } })).bySeverity).toEqual({ HIGH: 1 });
  });

  it("does not duplicate a finding that reappears, even when its line moves", async () => {
    await ingestScan(scan("s1", [finding()]));
    const r = await ingestScan(scan("s2", [finding({ line: 99 })]));
    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect(await appDb.finding.count()).toBe(1);
    expect(await appDb.finding.findFirstOrThrow()).toMatchObject({ line: 99, seenCount: 2, firstScanId: "s1", lastScanId: "s2" });
  });

  it("accepts a scan id once, so a replay changes nothing", async () => {
    await ingestScan(scan("s1", [finding()]));
    const again = await ingestScan(scan("s1", []));
    expect(again.duplicate).toBe(true);
    expect((await appDb.finding.findFirstOrThrow()).status).toBe("OPEN");
  });

  it("marks a finding fixed when its tool no longer reports it, and reopens it if it returns", async () => {
    await ingestScan(scan("s1", [finding()]));
    expect((await ingestScan(scan("s2", []))).fixed).toBe(1);
    expect(await appDb.finding.findFirstOrThrow()).toMatchObject({ status: "FIXED" });
    const back = await ingestScan(scan("s3", [finding()]));
    expect(back.reopened).toBe(1);
    expect(await appDb.finding.findFirstOrThrow()).toMatchObject({ status: "OPEN", fixedAt: null });
  });

  it("does not fix findings of a tool that did not run", async () => {
    await ingestScan(scan("s1", [finding()]));
    await ingestScan(scan("s2", [], ["gitleaks"]));
    expect((await appDb.finding.findFirstOrThrow()).status).toBe("OPEN");
  });

  it("leaves accepted risks and false positives as a person set them", async () => {
    await ingestScan(scan("s1", [finding(), finding({ fingerprint: "osv:other:pkg", ruleId: "other" })]));
    await appDb.finding.update({ where: { fingerprint: "osv:GHSA-aaaa-bbbb-cccc:lodash" }, data: { status: "ACCEPTED_RISK" } });
    await appDb.finding.update({ where: { fingerprint: "osv:other:pkg" }, data: { status: "FALSE_POSITIVE" } });
    await ingestScan(scan("s2", [finding()]));
    const rows = await appDb.finding.findMany({ orderBy: { fingerprint: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["ACCEPTED_RISK", "FALSE_POSITIVE"]);
  });

  it("keeps the highest severity when one report repeats a fingerprint", async () => {
    await ingestScan(scan("s1", [finding({ severity: "LOW" }), finding({ severity: "CRITICAL" })]));
    expect(await appDb.finding.count()).toBe(1);
    expect((await appDb.finding.findFirstOrThrow()).severity).toBe("CRITICAL");
  });

  it("never auto-fixes ai-review findings that merely went unreported", async () => {
    await ingestScan(scan("s1", [finding({ tool: "ai-review", source: "ai-review", fingerprint: "ai-review:idor:accept" })], ["ai-review"]));
    await ingestScan(scan("s2", [], ["ai-review"]));
    expect((await appDb.finding.findFirstOrThrow()).status).toBe("OPEN");
  });

  it("rejects a malformed report", async () => {
    await expect(ingestScan({ scanId: "x", kind: "weekly", tools: ["osv"], findings: [finding({ severity: "SEVERE" })] })).rejects.toThrow();
    await expect(ingestScan(scan("x", [finding({ fingerprint: "bad fingerprint!" })]))).rejects.toThrow();
    expect(await appDb.securityScan.count()).toBe(0);
  });
});

describe("verifyScanSignature", () => {
  const secret = "s3cret";
  const body = '{"scanId":"s1"}';
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const good = signScan(secret, ts, body);

  it("accepts a correct, fresh signature", () => {
    expect(verifyScanSignature({ secret, timestamp: ts, signature: good, body, now })).toEqual({ ok: true });
  });
  it("rejects a changed body, a wrong secret and missing headers", () => {
    expect(verifyScanSignature({ secret, timestamp: ts, signature: good, body: body + " ", now }).ok).toBe(false);
    expect(verifyScanSignature({ secret: "other", timestamp: ts, signature: good, body, now }).ok).toBe(false);
    expect(verifyScanSignature({ secret, timestamp: null, signature: good, body, now }).ok).toBe(false);
    expect(verifyScanSignature({ secret, timestamp: ts, signature: "zz", body, now }).ok).toBe(false);
  });
  it("rejects a stale or future timestamp even with a valid signature", () => {
    const old = String(now / 1000 - 600);
    expect(verifyScanSignature({ secret, timestamp: old, signature: signScan(secret, old, body), body, now }).ok).toBe(false);
    const future = String(now / 1000 + 600);
    expect(verifyScanSignature({ secret, timestamp: future, signature: signScan(secret, future, body), body, now }).ok).toBe(false);
  });
});

describe("securityReport", () => {
  it("counts what is open by severity, lists the worst first, and tracks the trend", async () => {
    const { securityReport } = await import("../src/domain/it");
    await ingestScan(scan("s1", [finding({ fingerprint: "osv:aaaaaaa:1", severity: "LOW" }), finding({ fingerprint: "osv:bbbbbbb:2", severity: "CRITICAL", message: "worst" })]));
    await ingestScan(scan("s2", [finding({ fingerprint: "osv:bbbbbbb:2", severity: "CRITICAL", message: "worst" })]));
    const r = await securityReport();
    expect(r.openTotal).toBe(1); // the low one is no longer reported, so it is fixed
    expect(r.openBySeverity.find((s) => s.severity === "CRITICAL")?.count).toBe(1);
    expect(r.top[0]).toMatchObject({ message: "worst", seenCount: 2 });
    expect(r.trend.map((t) => t.total)).toEqual([2, 1]);
    expect(r.lastScanKind).toBe("weekly");
  });

  it("has no last scan before the first one", async () => {
    const { securityReport } = await import("../src/domain/it");
    expect((await securityReport()).lastScanAt).toBeNull();
  });
});

describe("securityHeadline", () => {
  it("counts what is open by severity, how many are being fixed, and names the worst", async () => {
    const { securityHeadline } = await import("../src/domain/it");
    expect(await securityHeadline()).toMatchObject({ open: 0, beingFixed: 0, worst: null, lastScanAt: null });
    await ingestScan(scan("s1", [finding({ fingerprint: "osv:aaaaaaa:1", severity: "LOW" }), finding({ fingerprint: "osv:bbbbbbb:2", severity: "HIGH" }), finding({ fingerprint: "osv:ccccccc:3", severity: "HIGH" }), finding({ fingerprint: "osv:ddddddd:4", severity: "MEDIUM" })]));
    const req = await appDb.itRequest.create({ data: { number: "IT-9001", kind: "FINDING", title: "t", description: "d", status: "PR_OPEN", requestedByLabel: "IT assistant" } });
    await appDb.finding.update({ where: { fingerprint: "osv:bbbbbbb:2" }, data: { status: "FIXING", itRequestId: req.id } });
    const h = await securityHeadline();
    expect(h).toMatchObject({ open: 4, beingFixed: 1, worst: "HIGH" });
    expect(h.bySeverity).toMatchObject({ HIGH: 2, MEDIUM: 1, LOW: 1, CRITICAL: 0 });
    expect(h.lastScanAt).toBeInstanceOf(Date);
  });

  it("does not count fixed findings, accepted risks or false positives", async () => {
    const { securityHeadline } = await import("../src/domain/it");
    await ingestScan(scan("s1", [finding({ fingerprint: "osv:aaaaaaa:1" }), finding({ fingerprint: "osv:bbbbbbb:2" })]));
    await appDb.finding.update({ where: { fingerprint: "osv:aaaaaaa:1" }, data: { status: "ACCEPTED_RISK" } });
    await ingestScan(scan("s2", [])); // the other one is no longer reported
    expect((await securityHeadline()).open).toBe(0);
  });
});

describe("scan history", () => {
  it("keeps what each scan reported, so an earlier scan can be read after later ones change the findings", async () => {
    const { securityReport } = await import("../src/domain/it");
    await ingestScan(scan("s1", [finding({ fingerprint: "osv:aaaaaaa:1", severity: "LOW", message: "old low" }), finding({ fingerprint: "osv:bbbbbbb:2", severity: "CRITICAL", message: "old critical" })]));
    await ingestScan(scan("s2", [finding({ fingerprint: "osv:bbbbbbb:2", severity: "CRITICAL", message: "old critical" })]));
    const report = await securityReport();
    expect(report.history.map((h) => h.id)).toEqual(["s1"]); // the latest scan is the current results, not history
    expect(report.history[0]).toMatchObject({ total: 2 });
    expect(report.history[0]!.findings!.map((f) => f.message)).toEqual(["old critical", "old low"]); // worst first, even though s2 no longer has the low one
    expect(report.top.map((f) => f.message)).toEqual(["old critical"]);
  });

  it("says so when an older scan has no details", async () => {
    const { securityReport } = await import("../src/domain/it");
    await ingestScan(scan("s1", [finding()]));
    await ingestScan(scan("s2", []));
    await appDb.$executeRaw`UPDATE "SecurityScan" SET "findings" = NULL WHERE id = 's1'`;
    expect((await securityReport()).history[0]!.findings).toBeNull();
  });
});
