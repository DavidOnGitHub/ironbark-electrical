// Turns each scanner's raw JSON into the one finding shape POST /api/it/scan takes:
//   { tool, ruleId, severity, file, line, message, fingerprint, source }
// Fingerprints must survive line-number drift between runs, so they never contain a line. Secrets are never copied
// into a finding: gitleaks matches are described by rule and file only.
import { createHash } from "node:crypto";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const safe = (s) => String(s).replace(/[^A-Za-z0-9:_.-]+/g, "_").slice(0, 60);
const short = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 10);

/** CVSS base score to our scale. */
export function severityFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "MEDIUM";
  if (n >= 9) return "CRITICAL";
  if (n >= 7) return "HIGH";
  if (n >= 4) return "MEDIUM";
  if (n > 0) return "LOW";
  return "INFO";
}

const NAMED = { critical: "CRITICAL", high: "HIGH", moderate: "MEDIUM", medium: "MEDIUM", low: "LOW", info: "INFO", error: "HIGH", warning: "MEDIUM" };
const named = (s) => NAMED[String(s ?? "").toLowerCase()] ?? "MEDIUM";

/** osv-scanner --format json */
export function fromOsv(json) {
  const out = [];
  for (const result of json?.results ?? []) {
    const file = result?.source?.path ?? null;
    for (const pkg of result?.packages ?? []) {
      const { name, version } = pkg.package ?? {};
      for (const group of pkg.groups ?? []) {
        const id = (group.ids ?? [])[0];
        if (!id) continue;
        const vuln = (pkg.vulnerabilities ?? []).find((v) => v.id === id) ?? {};
        out.push({
          tool: "osv", ruleId: id, severity: severityFromScore(group.max_severity), file, line: null,
          message: clip(`${name}@${version}: ${vuln.summary ?? id}`, 500),
          fingerprint: `osv:${safe(id)}:${safe(name)}`, source: "scan",
        });
      }
    }
  }
  return out;
}

/** pnpm audit --json (advisories keyed by id) */
export function fromPnpmAudit(json) {
  return Object.values(json?.advisories ?? {}).map((a) => ({
    tool: "pnpm-audit", ruleId: String(a.github_advisory_id ?? a.id), severity: named(a.severity), file: "pnpm-lock.yaml", line: null,
    message: clip(`${a.module_name}: ${a.title}`, 500),
    fingerprint: `pnpm-audit:${safe(a.github_advisory_id ?? a.id)}:${safe(a.module_name)}`, source: "scan",
  }));
}

/** gitleaks --report-format json (an array; may be null when clean) */
export function fromGitleaks(json) {
  return (Array.isArray(json) ? json : []).map((l) => ({
    tool: "gitleaks", ruleId: l.RuleID, severity: "HIGH", file: l.File ?? null, line: l.StartLine ?? null,
    message: clip(`Possible secret (${l.Description ?? l.RuleID}) committed to the repository`, 500),
    fingerprint: `gitleaks:${safe(l.RuleID)}:${safe(l.File ?? "")}:${short(l.Fingerprint ?? l.Match ?? l.File)}`, source: "scan",
  }));
}

/** semgrep --json */
export function fromSemgrep(json) {
  const seen = new Map();
  return (json?.results ?? []).map((r) => {
    // Same rule in the same file: number the hits in order, so a moved line keeps its fingerprint.
    const key = `${r.check_id}|${r.path}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return {
      tool: "semgrep", ruleId: r.check_id, severity: named(r.extra?.severity), file: r.path ?? null, line: r.start?.line ?? null,
      message: clip(r.extra?.message, 500),
      fingerprint: `semgrep:${safe(r.check_id.split(".").slice(-2).join("."))}:${short(key)}:${n}`, source: "scan",
    };
  });
}

/** Builds the report from whichever tool outputs exist. A tool with no output did not run, so it is left out of
 *  `tools` and cannot mark its earlier findings fixed. `inputs` maps tool name to parsed JSON or undefined. */
export function buildReport({ scanId, kind, commit = null, inputs }) {
  const parsers = { osv: fromOsv, "pnpm-audit": fromPnpmAudit, gitleaks: fromGitleaks, semgrep: fromSemgrep };
  const tools = [];
  const findings = [];
  for (const [tool, parse] of Object.entries(parsers)) {
    if (inputs[tool] === undefined) continue;
    tools.push(tool);
    findings.push(...parse(inputs[tool]));
  }
  return { scanId, kind, commit, tools, findings };
}
