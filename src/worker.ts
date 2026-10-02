import { runWorker } from "@kabosh-digital/workflow-temporal/worker";
import { registerIronbark } from "./steps/register";

// Ironbark Electrical's worker: the engine plus the business's steps and test fixtures.
registerIronbark();
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
