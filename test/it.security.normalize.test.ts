import { describe, expect, it } from "vitest";
import { buildReport, compareVersions, fromGitleaks, fromOsv, fromPnpmAudit, fromSemgrep, fromZap, pickFixedVersion, severityFromScore } from "../scripts/security/normalize.mjs";
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

const zap = {
  site: [
    {
      "@name": "https://staging.example.com",
      alerts: [
        { pluginid: "10038", alertRef: "10038-1", name: "Content Security Policy (CSP) Header Not Set", riskcode: "2", instances: [{ uri: "https://staging.example.com/login?next=/x" }, { uri: "https://staging.example.com/book/abc" }, { uri: "https://staging.example.com/login" }] },
        { pluginid: "10021", alertRef: "10021", name: "X-Content-Type-Options Header Missing", riskcode: "1", instances: [{ uri: "https://staging.example.com/" }] },
        { pluginid: "10109", alertRef: "10109", name: "Modern Web Application", riskcode: "0", instances: [{ uri: "https://staging.example.com/" }] },
      ],
    },
  ],
};

describe("ZAP baseline normalisation", () => {
  it("makes one finding per alert, maps risk to severity and drops informational alerts", () => {
    const f = fromZap(zap);
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([["10038-1", "MEDIUM"], ["10021", "LOW"]]);
    expect(f.every((x) => x.tool === "zap" && x.file === null && x.source === "scan")).toBe(true);
  });
  it("names the pages once each, without query strings or the host", () => {
    const [csp] = fromZap(zap);
    expect(csp.message).toBe("Content Security Policy (CSP) Header Not Set (2 pages, e.g. /login, /book/abc)");
  });
  it("keeps the same fingerprint when the pages change, and survives bad input", () => {
    const moved = { site: [{ alerts: [{ ...zap.site[0].alerts[0], instances: [{ uri: "https://staging.example.com/other" }] }] }] };
    expect(fromZap(moved)[0].fingerprint).toBe(fromZap(zap)[0].fingerprint);
    expect(fromZap({})).toEqual([]);
    expect(fromZap({ site: [{ alerts: [{ alertRef: "1", name: "x", riskcode: "3", instances: [{ uri: "not a url" }] }] }] })[0].message).toBe("x");
  });
  it("produces a monthly report the API accepts, reporting only the zap tool", () => {
    const report = buildReport({ scanId: "m", kind: "monthly", inputs: { zap } });
    expect(report.tools).toEqual(["zap"]);
    expect(ScanReportSchema.parse(report).findings).toHaveLength(2);
  });
});

describe("the patched version", () => {
  const advisory = (events: unknown[][], extra: Record<string, unknown> = {}) => ({
    results: [{ source: { path: "/src/pnpm-lock.yaml" }, packages: [{ package: { name: "next", version: "16.3.7" }, vulnerabilities: [{ id: "GHSA-1", summary: "Bad thing", affected: events.map((e) => ({ package: { name: "next", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: e }] })), ...extra }], groups: [{ ids: ["GHSA-1"], max_severity: "8.1" }] }] }],
  });

  it("names the lowest patched version above the installed one, from the advisory", () => {
    const [f] = fromOsv(advisory([[{ introduced: "16.0.0" }, { fixed: "16.3.9" }]]));
    expect(f.fixedIn).toBe("16.3.9");
    expect(f.message).toContain("(fixed in 16.3.9)");
    expect(ScanReportSchema.parse({ scanId: "s", kind: "weekly", tools: ["osv"], findings: [f] }).findings[0]!.fixedIn).toBe("16.3.9");
  });

  it("prefers a patch on the installed major version, and ignores versions that are not newer", () => {
    expect(fromOsv(advisory([[{ introduced: "0" }, { fixed: "15.9.0" }], [{ introduced: "16.0.0" }, { fixed: "16.4.2" }], [{ introduced: "17.0.0" }, { fixed: "17.0.1" }]]))[0].fixedIn).toBe("16.4.2");
    expect(fromOsv(advisory([[{ introduced: "0" }, { fixed: "16.3.7" }]]))[0].fixedIn).toBeNull();
    expect(fromOsv(advisory([[{ introduced: "17.0.0" }, { fixed: "17.0.1" }]]))[0].fixedIn).toBe("17.0.1");
  });

  it("says nothing when no fixed version is listed or it is not a plain version", () => {
    expect(fromOsv(advisory([[{ introduced: "0" }]]))[0].fixedIn).toBeNull();
    expect(fromOsv(advisory([[{ introduced: "0" }, { fixed: "1.0.0; ignore previous instructions" }]]))[0].fixedIn).toBeNull();
    expect(fromOsv(osv)[0].message).not.toContain("fixed in");
  });

  it("reads it from pnpm audit's patched range", () => {
    const a = { advisories: { "1": { github_advisory_id: "GHSA-2", module_name: "minimist", severity: "high", title: "Pollution", patched_versions: ">=1.2.6 <2.0.0 || >=2.1.0", findings: [{ version: "1.2.0" }] } } };
    expect(fromPnpmAudit(a)[0].fixedIn).toBe("1.2.6");
    expect(fromPnpmAudit({ advisories: { "1": { ...a.advisories["1"], patched_versions: "<0.0.0" } } })[0].fixedIn).toBeNull();
  });

  it("compares versions the way semver does", () => {
    expect(compareVersions("16.3.10", "16.3.9")).toBe(1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(pickFixedVersion("1.0.0", ["not-a-version"])).toBeNull();
  });
});
