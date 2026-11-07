import { registerCustomStep, registerMockAgent } from "@kabosh-digital/workflow-temporal/worker";
import { ironSparkStepDefs } from "./defs";
import { ironSparkMockAgent } from "./fixtures";
import { stepImpls } from "./impl";
import { withErrorReporting } from "../automation/errorHooks";

let registered = false;

/** Plugs Ironbark Electrical's steps and test fixtures into the engine. Call once in the worker before runWorker(). */
export function registerIronbark(): void {
  if (registered) return;
  registered = true;
  for (const def of ironSparkStepDefs) {
    const execute = stepImpls[def.key];
    if (!execute) throw new Error(`no implementation for step "${def.key}"`);
    // A step that throws is recorded for the IT assistant, then fails exactly as before.
    registerCustomStep({ ...def, kind: "ACTION", execute: withErrorReporting(def.key, execute) } as Parameters<typeof registerCustomStep>[0]);
  }
  registerMockAgent("ironspark-agent", ironSparkMockAgent);
}
