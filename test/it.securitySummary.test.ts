import { describe, expect, it } from "vitest";
import { describeFinding, securitySummary, severityList, type SummaryFinding, type SummaryScan } from "../src/domain/it/securitySummary";

const at = new Date("2026-11-21T01:00:00Z"); // 21 Nov in Sydney
const scan = (over: Partial<SummaryScan> = {}): SummaryScan => ({ at, kind: "weekly", total: 3, outcome: { created: 0, reopened: 0, fixed: 0, newBySeverity: {} }, ...over });
const finding = (over: Partial<SummaryFinding> = {}): SummaryFinding => ({ severity: "MEDIUM", tool: "osv", status: "OPEN", message: "undici@7.30.0: request smuggling", fixedIn: "7.30.1", ...over });

describe("severityList", () => {
  it("lists worst first and leaves out severities with none", () => {
    expect(severityList({ LOW: 3, HIGH: 1, MEDIUM: 0 })).toBe("1 high, 3 low");
  });
});

describe("describeFinding", () => {
  it("names the package of a dependency finding and says when an update fixes it", () => {
    expect(describeFinding(finding())).toBe("a weakness in undici, a building block the app uses (a newer version fixes it)");
    expect(describeFinding(finding({ tool: "pnpm-audit", message: "no package here", fixedIn: null }))).toBe("a weakness in a building block the app uses");
  });
  it("never repeats a code finding's text or file", () => {
    const text = describeFinding(finding({ tool: "semgrep", message: "SQL injection in src/db/quotes.ts" }));
    expect(text).toBe("a possible weakness in the app's own code");
  });
  it("says a leaked secret needs a person", () => {
    expect(describeFinding(finding({ tool: "gitleaks", message: "AWS key in .env" }))).toMatch(/has to be changed .* assistant cannot/);
  });
});

describe("securitySummary", () => {
  it("says what the scan found, the comparison, what is open, the most urgent and what is being done", () => {
    const lines = securitySummary({
      latest: scan({ total: 3, outcome: { created: 2, reopened: 0, fixed: 1, newBySeverity: { HIGH: 1, LOW: 1 } } }),
      previous: scan({ total: 4 }),
      open: [finding({ severity: "LOW", tool: "semgrep" }), finding({ severity: "HIGH" }), finding({ status: "FIXING" })],
    });
    expect(lines).toEqual([
      "The scheduled scan on 21 Nov found 2 new problems: 1 high, 1 low, and confirmed 1 earlier problem is fixed.",
      "It reported 3 in all, down from 4 the scan before.",
      "3 problems are open: 1 high, 1 medium, 1 low.",
      "The most urgent (high) is a weakness in undici, a building block the app uses (a newer version fixes it).",
      "1 is being fixed; 2 are waiting for someone to choose: fix it, or accept the risk.",
    ]);
  });
  it("reports a quiet scan and nothing open", () => {
    expect(securitySummary({ latest: scan({ total: 0, outcome: { created: 0, reopened: 0, fixed: 2, newBySeverity: {} } }), previous: scan({ total: 2 }), open: [] })).toEqual([
      "The scheduled scan on 21 Nov found nothing new. It confirmed 2 earlier problems are fixed.",
      "It reported 0 in all, down from 2 the scan before.",
      "Nothing is open.",
    ]);
  });
  it("says when problems came back", () => {
    const [first] = securitySummary({ latest: scan({ outcome: { created: 0, reopened: 1, fixed: 0, newBySeverity: { MEDIUM: 1 } } }), previous: null, open: [finding()] });
    expect(first).toBe("The scheduled scan on 21 Nov found 1 new problem: 1 medium (it had been fixed before and came back).");
  });
  it("falls back to the total for a scan applied before outcomes were stored", () => {
    const [first] = securitySummary({ latest: scan({ kind: "manual", total: 5, outcome: null }), previous: null, open: [] });
    expect(first).toBe("The on-demand scan on 21 Nov reported 5 problems.");
  });
  it("does not offer a leaked secret as waiting for a fix", () => {
    const lines = securitySummary({ latest: scan(), previous: null, open: [finding({ tool: "gitleaks", severity: "HIGH" })] });
    expect(lines.at(-1)).toMatch(/^The most urgent \(high\) is a password or key/);
  });
});
