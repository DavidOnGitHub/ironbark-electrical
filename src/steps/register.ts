import { registerCustomStep, registerMockAgent } from "@kabosh-digital/workflow-temporal/worker";
import { ironSparkStepDefs } from "./defs";
import { ironSparkMockAgent } from "./fixtures";
import { stepImpls } from "./impl";

let registered = false;

/** Plugs Iron Spark's steps and test fixtures into the engine. Call once in the worker before runWorker(). */
export function registerIronSpark(): void {
  if (registered) return;
  registered = true;
  for (const def of ironSparkStepDefs) {
    const execute = stepImpls[def.key];
    if (!execute) throw new Error(`no implementation for step "${def.key}"`);
    registerCustomStep({ ...def, kind: "ACTION", execute } as Parameters<typeof registerCustomStep>[0]);
  }
  registerMockAgent("ironspark-agent", ironSparkMockAgent);
}
