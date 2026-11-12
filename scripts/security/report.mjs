// Usage: node scripts/security/report.mjs <dir> <kind>
// Reads osv.json, pnpm-audit.json, gitleaks.json and semgrep.json from <dir> (any may be missing), builds the report
// and POSTs it, HMAC-signed, to $IT_SCAN_URL. Without IT_SCAN_URL it prints the report (dry run).
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport } from "./normalize.mjs";

const [dir, kind = "manual"] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: report.mjs <dir> <weekly|monthly|manual>");
  process.exit(2);
}
const read = (name) => {
  const file = join(dir, name);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8").trim();
  if (!text) return undefined; // a tool that crashed leaves an empty file: treat as not run
  try {
    return JSON.parse(text);
  } catch {
    console.error(`Ignoring ${name}: not valid JSON`);
    return undefined;
  }
};
const inputs = { osv: read("osv.json"), "pnpm-audit": read("pnpm-audit.json"), gitleaks: read("gitleaks.json"), semgrep: read("semgrep.json") };
// gitleaks writes null/empty when clean; an existing file with null means it ran.
if (existsSync(join(dir, "gitleaks.json")) && inputs.gitleaks === undefined && readFileSync(join(dir, "gitleaks.json"), "utf8").trim() === "null") inputs.gitleaks = [];

const report = buildReport({ scanId: process.env.SCAN_ID || `${kind}-${Date.now()}`, kind, commit: process.env.GITHUB_SHA, inputs });
if (report.tools.length === 0) {
  console.error("No scanner produced output; nothing to send.");
  process.exit(1);
}
console.log(`Tools: ${report.tools.join(", ")}; findings: ${report.findings.length}`);

const url = process.env.IT_SCAN_URL;
const secret = process.env.IT_SCAN_SECRET;
if (!url) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
if (!secret) {
  console.error("IT_SCAN_SECRET is not set.");
  process.exit(1);
}
const body = JSON.stringify(report);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-scan-timestamp": timestamp, "x-scan-signature": signature }, body });
console.log(`POST ${url} -> ${res.status} ${await res.text()}`);
if (!res.ok) process.exit(1);
