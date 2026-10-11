/**
 * Stops quote follow-up runs whose quote is no longer waiting for an answer (approved, declined, expired...) -
 * for runs that were left asleep before answers stopped them automatically. Usage: pnpm tsx --env-file=.env scripts/stopFinishedChases.ts
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { appDb } from "../src/db/app";
import { AUTOMATION_IDS, stopQuoteChase } from "../src/automation";

const running = await prisma.workflowInstance.findMany({ where: { definitionId: AUTOMATION_IDS.quoteChase, status: "RUNNING", mode: "PRODUCTION" }, select: { context: true } });
let stopped = 0;
for (const r of running) {
  const quoteId = (r.context as { trigger?: { quoteId?: string } } | null)?.trigger?.quoteId;
  if (!quoteId) continue;
  const quote = await appDb.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (quote?.status === "SENT") continue; // still waiting: leave it chasing
  stopped += await stopQuoteChase(quoteId);
}
console.log(`Stopped ${stopped} follow-up run(s) of ${running.length} running.`);
await prisma.$disconnect();
await appDb.$disconnect();
