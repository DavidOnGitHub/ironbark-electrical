import { prisma } from "@kabosh-digital/workflow-schema";
import { getTemporalClient, TASK_QUEUE } from "@kabosh-digital/workflow-temporal";
import { appDb } from "../src/db/app";
import { reconcileRuns } from "../src/automation/reconcile";
import { isAllowedRecipient } from "../src/integrations/allowlist";

/** Is the demo ready to show? Run before every walkthrough: `pnpm demo:check`. Exit code 1 if anything essential fails. */
type Level = "ok" | "warn" | "fail";
const results: { level: Level; name: string; detail: string }[] = [];
const note = (level: Level, name: string, detail: string) => results.push({ level, name, detail });
async function check(name: string, fn: () => Promise<[Level, string]>) {
  try {
    const [level, detail] = await fn();
    note(level, name, detail);
  } catch (err) {
    note("fail", name, err instanceof Error ? err.message.split("\n")[0] : String(err));
  }
}

const baseUrl = process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3200";

await check("App is running", async () => {
  const res = await fetch(`${baseUrl}/auth/signin`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  return res.status < 500 ? ["ok", baseUrl] : ["fail", `${baseUrl} answered ${res.status}`];
});

await check("Demo data is seeded", async () => {
  const [clients, requests, users] = await Promise.all([appDb.client.count(), appDb.request.count(), prisma.user.count({ where: { email: { endsWith: "@ironbark.test" } } })]);
  if (clients === 0 || users < 5) return ["fail", "no demo data - run `pnpm seed` (or `pnpm demo:reset` to wipe and start over)"];
  const fresh = await appDb.request.count({ where: { status: "NEW" } });
  return fresh >= 3 ? ["ok", `${clients} clients, ${requests} requests (${fresh} new), ${users} demo accounts`] : ["warn", `only ${fresh} new enquiries on the dashboard - that is fine unless you want more to show`];
});

await check("Temporal is reachable", async () => {
  const client = await getTemporalClient();
  const res = await client.workflowService.describeTaskQueue({ namespace: client.options.namespace, taskQueue: { name: TASK_QUEUE }, taskQueueType: 1 });
  const pollers = res.pollers?.length ?? 0;
  return pollers > 0 ? ["ok", `namespace ${client.options.namespace}, worker polling`] : ["fail", `namespace ${client.options.namespace} reachable but no worker - start \`pnpm worker\``];
});

await check("Automations are published", async () => {
  const defs = await prisma.workflowDefinition.findMany({ where: { id: { startsWith: "def_ironspark_" } }, select: { name: true, status: true } });
  const live = defs.filter((d) => d.status === "PUBLISHED").length;
  if (defs.length === 0) return ["fail", "workflows missing - run `pnpm workflows:seed --publish` (keeps your data)"];
  if (process.env.AUTOMATIONS === "off") return ["warn", "AUTOMATIONS=off - nothing will start by itself"];
  return live === defs.length ? ["ok", `${live} of ${defs.length} published`] : ["warn", `${live} of ${defs.length} published - run \`pnpm workflows:seed --publish\``];
});

await check("Open tasks match live workflows", async () => {
  const r = await reconcileRuns();
  if (r.skipped) return ["warn", `${r.skipped} run(s) could not be checked against Temporal`];
  return ["ok", r.closedRuns || r.removedTasks ? `cleaned up: ${r.closedRuns} lost run(s), ${r.removedTasks} orphaned task(s)` : "no orphaned tasks"];
});

await check("Gmail is connected", async () => {
  const gmail = await prisma.connector.findFirst({ where: { type: "EMAIL" }, select: { name: true, oauthStatus: true, config: true } });
  if (!gmail) return ["warn", "no Gmail account connected (Owner > Connected apps) - emails fall back to tasks"];
  return gmail.oauthStatus === "connected" ? ["ok", String((gmail.config as { fromAddress?: string } | null)?.fromAddress ?? gmail.name)] : ["fail", `Gmail status "${gmail.oauthStatus}" - reconnect it`];
});

await check("Real email is limited to the allowlist", async () => {
  const list = process.env.EMAIL_ALLOWLIST;
  if (!list) return ["warn", "EMAIL_ALLOWLIST is empty - no real email will be sent (safe)"];
  const inbox = process.env.DEMO_INBOX;
  return inbox && isAllowedRecipient(inbox) ? ["ok", `allowed: ${list}`] : ["warn", `DEMO_INBOX ${inbox ?? "(unset)"} is not on the allowlist, so demo clients will not get email`];
});

await check("Stripe test mode", async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return ["warn", "STRIPE_SECRET_KEY missing - invoices have no pay link"];
  if (!key.startsWith("sk_test_")) return ["fail", "STRIPE_SECRET_KEY is not a test key"];
  const res = await fetch("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return ["fail", `Stripe answered ${res.status} - check the key`];
  return process.env.STRIPE_WEBHOOK_SECRET ? ["ok", "key works; webhook secret set (is `stripe listen` running?)"] : ["warn", "key works but STRIPE_WEBHOOK_SECRET is missing - payments will not be recorded"];
});

const mark: Record<Level, string> = { ok: "PASS", warn: "WARN", fail: "FAIL" };
for (const r of results) console.log(`${mark[r.level]}  ${r.name}: ${r.detail}`);
const failed = results.filter((r) => r.level === "fail").length;
const warned = results.filter((r) => r.level === "warn").length;
console.log(failed ? `\n${failed} problem(s) to fix before the demo.` : warned ? `\nReady, with ${warned} warning(s).` : "\nReady to demo.");
await appDb.$disconnect();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
