import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { ingestScan, securityGroups } from "../src/domain/it";
import { truncateAll } from "./helpers";

const f = (over: Record<string, unknown>) => ({ tool: "osv", ruleId: "GHSA-x", severity: "HIGH", file: "pnpm-lock.yaml", message: "undici@7.1.0: one", fixedIn: "7.30.1", fingerprint: "osv:aaaaaaaa:1", ...over });
const scan = (id: string, findings: unknown[]) => ({ scanId: id, kind: "weekly", tools: ["osv", "semgrep"], findings });
const request = (number: string, status: string) => appDb.itRequest.create({ data: { number, kind: "FINDING", title: "t", description: "d", status: status as never, requestedByLabel: "IT assistant", prUrl: `https://github.com/o/r/pull/${number.slice(3)}` } });

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("securityGroups", () => {
  it("puts advisories against one package in one row and names the fix that covers it", async () => {
    await ingestScan(scan("s1", [f({}), f({ fingerprint: "osv:bbbbbbbb:2", message: "undici@7.1.0: two", severity: "CRITICAL" }), f({ fingerprint: "osv:cccccccc:3", message: "zod@3.0.0: other" })]));
    const req = await request("IT-77", "PR_OPEN");
    await appDb.finding.updateMany({ where: { message: { startsWith: "undici" } }, data: { status: "FIXING", itRequestId: req.id } });
    const { groups } = await securityGroups();
    expect(groups.map((g) => g.title)).toEqual(["undici", "zod"]); // critical first
    expect(groups[0]).toMatchObject({ severity: "CRITICAL", fix: { kind: "inProgress", requestNumber: "IT-77", requestId: req.id } });
    expect(groups[0]!.fix.text).toMatch(/Being fixed in IT-77/);
    expect(groups[0]!.findings).toHaveLength(2);
    expect(groups[1]).toMatchObject({ fix: { kind: "pending" }, selectable: true, fixable: true });
    expect(groups[0]).toMatchObject({ selectable: false });
  });

  it("says plainly when a fix merged, failed, or cannot be fixed by the assistant", async () => {
    await ingestScan(scan("s1", [f({ message: "next@1.0.0: a", fingerprint: "osv:aaaaaaaa:1" }), f({ message: "vite@1.0.0: b", fingerprint: "osv:bbbbbbbb:2" }), f({ tool: "gitleaks", message: "Possible secret", fingerprint: "gitleaks:aws:cccccccc" })]));
    const merged = await request("IT-1", "LIVE");
    const failed = await request("IT-2", "BUILD_FAILED");
    await appDb.finding.update({ where: { fingerprint: "osv:aaaaaaaa:1" }, data: { status: "FIXING", itRequestId: merged.id } });
    await appDb.finding.update({ where: { fingerprint: "osv:bbbbbbbb:2" }, data: { status: "FIXING", itRequestId: failed.id } });
    const by = Object.fromEntries((await securityGroups()).groups.map((g) => [g.title, g.fix]));
    expect(by.next).toMatchObject({ kind: "merged", requestNumber: "IT-1", prUrl: expect.stringContaining("/pull/1") });
    expect(by.vite).toMatchObject({ kind: "failed" });
    expect(by["Possible secret"]).toMatchObject({ kind: "manual" });
    expect(by["Possible secret"]!.text).toMatch(/rotated by a person/);
  });

  it("lists recently fixed findings with the fix that cleared them, or says the scan stopped reporting them", async () => {
    await ingestScan(scan("s1", [f({ message: "next@1.0.0: a", fingerprint: "osv:aaaaaaaa:1" }), f({ message: "vite@1.0.0: b", fingerprint: "osv:bbbbbbbb:2" })]));
    const req = await request("IT-5", "LIVE");
    await appDb.finding.update({ where: { fingerprint: "osv:aaaaaaaa:1" }, data: { itRequestId: req.id } });
    await ingestScan(scan("s2", []));
    const { recentlyFixed, groups } = await securityGroups();
    expect(groups).toEqual([]);
    expect(recentlyFixed.find((r) => r.message.startsWith("next"))).toMatchObject({ requestNumber: "IT-5" });
    expect(recentlyFixed.find((r) => r.message.startsWith("vite"))).toMatchObject({ requestNumber: null });
  });
});
