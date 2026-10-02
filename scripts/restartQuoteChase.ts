/**
 * Starts the quote-and-chase automation afresh for one quote (for example after the workflow changed), cancelling
 * any run of it that is still going. Usage: pnpm tsx --env-file=.env scripts/restartQuoteChase.ts Q-1032
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { cancelWorkflowInstance } from "@kabosh-digital/workflow-temporal/client";
import { appDb } from "../src/db/app";
import { AUTOMATION_IDS, afterQuoteSent } from "../src/automation";

const number = process.argv[2];
if (!number) throw new Error("Give the quote number, e.g. Q-1032.");
const quote = await appDb.quote.findUnique({ where: { number } });
if (!quote) throw new Error(`No quote ${number}.`);
if (quote.status !== "SENT") throw new Error(`${number} is ${quote.status}, not SENT - there is nothing to chase.`);

const running = await prisma.workflowInstance.findMany({ where: { definitionId: AUTOMATION_IDS.quoteChase, status: "RUNNING", mode: "PRODUCTION" }, select: { id: true, context: true } });
for (const r of running) {
  if (((r.context as { trigger?: { quoteId?: string } } | null)?.trigger?.quoteId) !== quote.id) continue;
  await cancelWorkflowInstance(r.id);
  await prisma.workflowTask.deleteMany({ where: { instanceId: r.id, status: "PENDING" } }); // its approval task is no longer needed
  console.log(`Cancelled the earlier run ${r.id}.`);
}
console.log(await afterQuoteSent(quote.id));
await prisma.$disconnect();
await appDb.$disconnect();
