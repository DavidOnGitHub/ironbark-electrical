// Turns each scanner's raw JSON into the one finding shape POST /api/it/scan takes:
//   { tool, ruleId, severity, file, line, message, fingerprint, source }
// Fingerprints must survive line-number drift between runs, so they never contain a line. Secrets are never copied
// into a finding: gitleaks matches are described by rule and file only.
import { createHash } from "node:crypto";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const safe = (s) => String(s).replace(/[^A-Za-z0-9:_.-]+/g, "_").slice(0, 60);
const short = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 10);

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const parts = (v) => String(v).split("-")[0].split(".").map(Number);
/** Compares two x.y.z versions (a pre-release tag counts as lower than the same release). */
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  const [pa, pb] = [String(a).includes("-"), String(b).includes("-")];
  return pa === pb ? 0 : pa ? -1 : 1;
}

/**
 * The version to move to: the lowest patched version above the installed one, staying on the installed major version when
 * a patch exists there (a smaller change), else the lowest overall. Null when there is nothing newer to name.
 */
export function pickFixedVersion(installed, candidates) {
  const have = VERSION.test(String(installed ?? ""));
  const fixed = [...new Set(candidates.map(String))].filter((v) => VERSION.test(v) && (!have || compareVersions(v, installed) > 0)).sort(compareVersions);
  if (fixed.length === 0) return null;
  if (!have) return fixed[0];
  return fixed.find((v) => parts(v)[0] === parts(installed)[0]) ?? fixed[0];
}

/** Versions an advisory says are patched, from a `patched_versions` range such as ">=1.2.3 <2.0.0 || >=2.0.1". */
function patchedFromRange(range) {
  return [...String(range ?? "").matchAll(/>=\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)].map((m) => m[1]);
}

const withFix = (message, fixedIn) => (fixedIn ? `${message} (fixed in ${fixedIn})` : message);

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
        // Every "fixed" event the advisory lists for this package (its other ids in the group describe the same problem).
        const fixes = (pkg.vulnerabilities ?? [])
          .filter((v) => v.id === id || (group.ids ?? []).includes(v.id) || (group.aliases ?? []).includes(v.id))
          .flatMap((v) => v.affected ?? [])
          .filter((a) => !a.package?.name || a.package.name === name)
          .flatMap((a) => a.ranges ?? [])
          .flatMap((r) => r.events ?? [])
          .map((e) => e.fixed)
          .filter(Boolean);
        const fixedIn = pickFixedVersion(version, fixes);
        out.push({
          tool: "osv", ruleId: id, severity: severityFromScore(group.max_severity), file, line: null,
          message: clip(withFix(`${name}@${version}: ${vuln.summary ?? id}`, fixedIn), 500),
          fixedIn,
          fingerprint: `osv:${safe(id)}:${safe(name)}`, source: "scan",
        });
      }
    }
  }
  return out;
}

/** pnpm audit --json (advisories keyed by id) */
export function fromPnpmAudit(json) {
  return Object.values(json?.advisories ?? {}).map((a) => {
    const installed = (a.findings ?? []).map((f) => f.version).filter(Boolean).sort(compareVersions)[0];
    const fixedIn = pickFixedVersion(installed, patchedFromRange(a.patched_versions));
    return {
      tool: "pnpm-audit", ruleId: String(a.github_advisory_id ?? a.id), severity: named(a.severity), file: "pnpm-lock.yaml", line: null,
      message: clip(withFix(`${a.module_name}: ${a.title}`, fixedIn), 500),
      fixedIn,
      fingerprint: `pnpm-audit:${safe(a.github_advisory_id ?? a.id)}:${safe(a.module_name)}`, source: "scan",
    };
  });
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
