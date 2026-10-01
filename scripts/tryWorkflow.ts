/**
 * Runs one of the four workflows end to end in TEST mode against the real Temporal worker:
 * emails are mocked, the AI uses its stand-in, delays are capped at 5 seconds and nothing in the
 * business data changes. Human tasks are completed automatically so the whole path is walked.
 *
 *   pnpm worker                                  (in another terminal)
 *   pnpm workflows:try quoteChase
 *   pnpm workflows:try invoiceChase | reviewRequest | enquiry [emergency|noise|reject]
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { startInstanceForDefinition } from "@kabosh-digital/workflow-temporal/instances";
import { signalCompleteTask } from "@kabosh-digital/workflow-temporal/client";
import { WorkflowDefinitionGraphSchema } from "@kabosh-digital/workflow-types";
import { appDb } from "../src/db/app";
import { AUTOMATION_IDS, type AutomationKey } from "../src/automation";

const [which = "quoteChase", variant = ""] = process.argv.slice(2);
const keyFor: Record<string, AutomationKey> = { enquiry: "enquiryToReply", enquiryToReply: "enquiryToReply", quoteChase: "quoteChase", invoiceChase: "invoiceChase", reviewRequest: "reviewRequest" };
const key = keyFor[which];
if (!key) throw new Error(`Unknown workflow "${which}". Try: ${Object.keys(keyFor).join(", ")}`);

const def = await prisma.workflowDefinition.findUnique({ where: { id: AUTOMATION_IDS[key] } });
if (!def) throw new Error("Run `pnpm workflows:seed` first.");
const graph = WorkflowDefinitionGraphSchema.parse(def.graph);

let trigger: Record<string, unknown>;
if (key === "quoteChase") {
  const q = await appDb.quote.findFirst({ where: { status: "SENT" }, orderBy: { createdAt: "desc" } });
  if (!q) throw new Error("No sent quote in the data - run `pnpm reset`.");
  trigger = { quoteId: q.id };
} else if (key === "invoiceChase") {
  const i = await appDb.invoice.findFirst({ where: { status: { in: ["SENT", "PARTIALLY_PAID"] } }, orderBy: { createdAt: "desc" } });
  if (!i) throw new Error("No issued invoice in the data - run `pnpm reset`.");
  trigger = { invoiceId: i.id };
} else if (key === "reviewRequest") {
  const i = await appDb.invoice.findFirst({ where: { status: "PAID" }, orderBy: { createdAt: "desc" } });
  if (!i) throw new Error("No paid invoice in the data - run `pnpm reset`.");
  trigger = { invoiceId: i.id };
} else {
  const samples: Record<string, { from: string; subject: string; body: string }> = {
    "": { from: "Pat Smith <pat.smith@example.net>", subject: "Quote for 6 downlights", body: "Hi, could you quote on installing 6 downlights in our lounge room? Call me on 0412 345 678. Thanks, Pat" },
    emergency: { from: "Sam Lee <sam.lee@example.org>", subject: "Burning smell from the switchboard", body: "There is a burning smell coming from our switchboard and I heard sparks. Please help. 0411 222 333" },
    noise: { from: "Growth Team <hello@seo-boost.example>", subject: "50% off SEO services this week", body: "Boost your ranking! Click to unsubscribe." },
  };
  trigger = { ...(samples[variant] ?? samples[""]!), received_at: new Date().toISOString(), message_id: "msg_try_1" };
}

console.log(`Running "${graph.name}" in test mode with`, JSON.stringify(trigger).slice(0, 160));
const before = { requests: await appDb.request.count(), events: await appDb.activityEvent.count() };
const { instanceId } = await startInstanceForDefinition({ definitionId: def.id, graph, initialContext: trigger, mode: "TEST", graphVersion: def.version, graphStatus: "DRAFT" });

const done = new Set<string>();
const started = Date.now();
let instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
while (instance.status === "RUNNING" && Date.now() - started < 90_000) {
  await new Promise((r) => setTimeout(r, 700));
  const tasks = await prisma.workflowTask.findMany({ where: { instanceId, status: "PENDING" } });
  for (const t of tasks) {
    if (done.has(t.id)) continue;
    done.add(t.id);
    const config = (t.input ?? {}) as { approval?: boolean; taskType?: string };
    console.log(`  - human task "${t.nodeId}" (${config.taskType ?? "task"}): completing as ${config.approval ? (variant === "reject" ? "REJECTED" : "approved") : "done"}`);
    await signalCompleteTask(instanceId, t.nodeId, config.approval ? { approved: variant !== "reject" } : { done: true });
  }
  instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
}

const ctx = (instance.context ?? {}) as Record<string, unknown>;
const path = Object.keys(ctx).filter((k) => k !== "trigger" && !k.startsWith("$"));
console.log(`\nResult: ${instance.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log("Path:", path.join(" -> "));
const sent = path.filter((k) => (ctx[k] as { sent?: boolean })?.sent !== undefined).map((k) => `${k}: to ${(ctx[k] as { to?: string }).to} "${(ctx[k] as { subject?: string }).subject}"`);
if (sent.length) console.log("Emails (mocked):\n  " + sent.join("\n  "));
const after = { requests: await appDb.request.count(), events: await appDb.activityEvent.count() };
console.log(`Business data changed by the test run: requests ${after.requests - before.requests}, timeline events ${after.events - before.events} (both should be 0)`);
process.exitCode = instance.status === "COMPLETED" ? 0 : 1;
await prisma.$disconnect();
await appDb.$disconnect();
process.exit();
