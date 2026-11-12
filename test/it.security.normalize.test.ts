import { describe, expect, it } from "vitest";
import { buildReport, fromGitleaks, fromOsv, fromPnpmAudit, fromSemgrep, severityFromScore } from "../scripts/security/normalize.mjs";
import { ScanReportSchema } from "../src/domain/it";

const osv = { results: [{ source: { path: "/src/pnpm-lock.yaml" }, packages: [{ package: { name: "lodash", version: "4.17.0" }, vulnerabilities: [{ id: "GHSA-1", summary: "Prototype pollution" }], groups: [{ ids: ["GHSA-1"], max_severity: "7.4" }] }] }] };
const audit = { advisories: { "1": { id: 1, github_advisory_id: "GHSA-2", module_name: "minimist", severity: "moderate", title: "Pollution" } } };
const leaks = [{ RuleID: "stripe-key", Description: "Stripe key", File: "src/a.ts", StartLine: 4, Fingerprint: "abc:src/a.ts:stripe-key:4", Match: "REDACTED" }];
const semgrep = { results: [{ check_id: "typescript.react.xss", path: "src/x.tsx", start: { line: 8 }, extra: { message: "Unsafe HTML", severity: "ERROR" } }] };

describe("scan normalisation", () => {
  it("maps CVSS scores to severities", () => {
    expect([9.8, 7.4, 5, 2, 0].map(severityFromScore)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
  });
  it("produces a report the API accepts, from every tool", () => {
    const report = buildReport({ scanId: "s", kind: "weekly", inputs: { osv, "pnpm-audit": audit, gitleaks: leaks, semgrep } });
    expect(report.tools).toEqual(["osv", "pnpm-audit", "gitleaks", "semgrep"]);
    expect(ScanReportSchema.parse(report).findings).toHaveLength(4);
  });
  it("keeps a fingerprint when only the line number changes", () => {
    const moved = { results: [{ ...semgrep.results[0], start: { line: 99 } }] };
    expect(fromSemgrep(moved)[0].fingerprint).toBe(fromSemgrep(semgrep)[0].fingerprint);
    const leakMoved = [{ ...leaks[0], StartLine: 40, Fingerprint: leaks[0].Fingerprint }];
    expect(fromGitleaks(leakMoved)[0].fingerprint).toBe(fromGitleaks(leaks)[0].fingerprint);
  });
  it("never copies the secret into a finding", () => {
    const text = JSON.stringify(fromGitleaks([{ ...leaks[0], Secret: "sk_live_123", Match: "sk_live_123" }]));
    expect(text).not.toContain("sk_live_123");
  });
  it("leaves a tool that produced no output out of `tools`", () => {
    const report = buildReport({ scanId: "s", kind: "weekly", inputs: { osv, gitleaks: undefined } });
    expect(report.tools).toEqual(["osv"]);
  });
  it("treats a clean gitleaks run as ran with no findings", () => {
    expect(buildReport({ scanId: "s", kind: "weekly", inputs: { gitleaks: [] } }).tools).toEqual(["gitleaks"]);
    expect(fromOsv({})).toEqual([]);
    expect(fromPnpmAudit({})).toEqual([]);
  });
});
