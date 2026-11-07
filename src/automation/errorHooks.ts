import { Context } from "@temporalio/activity";
import type { WorkflowContext } from "@kabosh-digital/workflow-types";
import { reportError } from "../domain/it";
import { isTestRun } from "../steps/runtime";

/** How long a failing step waits for its error to be recorded before it fails anyway. */
export const REPORT_WAIT_MS = 5_000;

type Step<C> = (config: C, context: WorkflowContext) => Promise<unknown>;

/** The id of the workflow run this step is part of (Temporal's), so a failure can be traced to its workflow. */
function currentRunId(): string | undefined {
  try {
    return Context.current().info.workflowExecution?.workflowId;
  } catch {
    return undefined; // not inside an activity (a unit test, a direct call)
  }
}

/**
 * Wraps a step so that when it throws, the error is recorded for the IT assistant (and, when switched on, a fix is
 * opened) before it goes on its way. The original error is always rethrown unchanged, so retries and the workflow's
 * own failure handling behave exactly as before, and a failure to record never hides the real one.
 *
 * Covers the integration steps (Gmail, Stripe) along with the rest. Editor "Test runs" are not reported: they use
 * made-up data and are expected to fail now and then.
 */
export function withErrorReporting<C>(key: string, execute: Step<C>): Step<C> {
  return async (config, context) => {
    try {
      return await execute(config, context);
    } catch (err) {
      if (!isTestRun(context)) {
        try {
          const reporting = reportError(err, { source: "step", route: `step:${key}`, context: { stepKey: key, ...(currentRunId() ? { instanceId: currentRunId() } : {}) } });
          // Recording is quick, but preparing a fix can take minutes; the step's own failure must not wait for that. The
          // report carries on in the background (the worker stays up) once the wait is over.
          await Promise.race([reporting.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, REPORT_WAIT_MS).unref())]);
        } catch {
          // Recording must never get in the way of the real error.
        }
      }
      throw err;
    }
  };
}
