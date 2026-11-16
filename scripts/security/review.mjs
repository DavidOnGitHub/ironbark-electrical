// Usage: node scripts/security/review.mjs
// Asks the app to run its AI security review: POSTs {"runId"} to the review endpoint, HMAC-signed like the scan report
// (same IT_SCAN_SECRET). The endpoint is IT_SCAN_URL with its trailing /scan replaced by /review. The review runs in
// the app (which holds the model key) and this waits for it, so a failure fails the job.
import { createHmac } from "node:crypto";

const scanUrl = process.env.IT_SCAN_URL;
const secret = process.env.IT_SCAN_SECRET;
if (!scanUrl || !secret) {
  console.error("IT_SCAN_URL and IT_SCAN_SECRET must be set.");
  process.exit(1);
}
const url = scanUrl.replace(/\/scan\/?$/, "/review");
if (url === scanUrl) {
  console.error(`IT_SCAN_URL (${scanUrl}) does not end in /scan, so the review address cannot be worked out.`);
  process.exit(1);
}
const body = JSON.stringify({ runId: `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}` });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-scan-timestamp": timestamp, "x-scan-signature": signature }, body, signal: AbortSignal.timeout(10 * 60_000) });
console.log(`POST ${url} -> ${res.status} ${await res.text()}`);
// 429 means a review already finished within the hour (a manual run right after a scheduled one): not a failure.
if (!res.ok && res.status !== 429) process.exit(1);
