/**
 * Removes tasks whose workflow no longer exists in Temporal ("workflow not found for ID") and closes runs whose
 * workflow is gone. Keeps everything else. Usage: pnpm runs:reconcile
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { reconcileRuns } from "../src/automation/reconcile";

const r = await reconcileRuns();
console.log(`Closed ${r.closedRuns} lost run(s), removed ${r.removedTasks} orphaned task(s)${r.skipped ? `, skipped ${r.skipped} (Temporal could not be asked)` : ""}.`);
await prisma.$disconnect();
