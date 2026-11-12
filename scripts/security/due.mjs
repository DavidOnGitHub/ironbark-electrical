// Usage: node scripts/security/due.mjs
// Asks the app whether a scheduled scan is due today (POST $IT_SCAN_URL/due, HMAC-signed with an empty body) and
// writes due=true|false to $GITHUB_OUTPUT. If the app cannot be asked, it says so and answers false: a scan could not
// be delivered to an app that is down anyway.
import { createHmac } from "node:crypto";
import { appendFileSync } from "node:fs";

const url = process.env.IT_SCAN_URL;
const secret = process.env.IT_SCAN_SECRET;
const out = process.env.GITHUB_OUTPUT;
const answer = (due, why) => {
  console.log(`due=${due} (${why})`);
  if (out) appendFileSync(out, `due=${due}\n`);
};
if (!url || !secret) {
  console.log("::warning::IT_SCAN_URL or IT_SCAN_SECRET is not set; skipping the scheduled scan.");
  answer(false, "not configured");
  process.exit(0);
}
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${timestamp}.`).digest("hex");
try {
  const res = await fetch(`${url.replace(/\/+$/, "")}/due`, { method: "POST", headers: { "x-scan-timestamp": timestamp, "x-scan-signature": signature }, signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || typeof json?.due !== "boolean") {
    console.log(`::warning::Could not ask the app whether a scan is due (HTTP ${res.status}); skipping.`);
    answer(false, "no answer");
  } else answer(json.due, json.reason);
} catch (err) {
  console.log(`::warning::Could not reach the app to ask whether a scan is due: ${err instanceof Error ? err.message : err}`);
  answer(false, "unreachable");
}
