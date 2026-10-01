import { runWorker } from "@kabosh-digital/workflow-temporal/worker";
import { registerIronSpark } from "./steps/register";

// Iron Spark's worker: the engine plus the business's steps and test fixtures.
registerIronSpark();
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
