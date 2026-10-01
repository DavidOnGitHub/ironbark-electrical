import { runWorker } from "@kabosh-digital/workflow-temporal/worker";

// Iron Spark's worker: the engine now; the business's custom steps are
// registered here as they are built (Phase 3).
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
