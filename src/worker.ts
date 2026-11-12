import { runWorker } from "@kabosh-digital/workflow-temporal/worker";
import { registerIronbark } from "./steps/register";
import { startReconciling } from "./automation/reconcile";
import { startItSync } from "./automation/itSync";
import { startFailedRunWatch } from "./automation/failedRuns";

// Ironbark Electrical's worker: the engine plus the business's steps and test fixtures.
registerIronbark();
startReconciling(); // tasks must not outlive their workflow (Temporal forgets closed ones after 24h)
startItSync(); // mirrors the IT assistant's progress onto IT requests
startFailedRunWatch(); // records workflow runs that failed without a step reporting why
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
