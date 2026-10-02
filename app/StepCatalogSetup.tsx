"use client";

import { registerStepMetadata } from "@kabosh-digital/workflow-temporal/catalog";
import { ironSparkStepDefs, sendTemplatedEmailDef } from "../src/steps/defs";

// Runs in the browser bundle (and during server rendering) so the workflow builder's palette,
// config forms and run viewers know this business's steps - see registerStepMetadata's doc.
registerStepMetadata(ironSparkStepDefs);

/** `templateKeys` are the business's current email templates: the builder's email step shows them as a dropdown. */
export function StepCatalogSetup({ templateKeys }: { templateKeys: string[] }) {
  registerStepMetadata([sendTemplatedEmailDef(templateKeys)]);
  return null;
}
