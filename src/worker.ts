import { runWorker } from "@kabosh-digital/workflow-temporal/worker";
import { registerIronbark } from "./steps/register";
import { startReconciling } from "./automation/reconcile";

// Ironbark Electrical's worker: the engine plus the business's steps and test fixtures.
registerIronbark();
startReconciling(); // tasks must not outlive their workflow (Temporal forgets closed ones after 24h)
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
