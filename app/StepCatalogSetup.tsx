"use client";

import { registerStepMetadata } from "@kabosh-digital/workflow-temporal/catalog";
import { ironSparkStepDefs } from "../src/steps/defs";

// Runs in the browser bundle (and during server rendering) so the workflow builder's palette,
// config forms and run viewers know this business's steps - see registerStepMetadata's doc.
registerStepMetadata(ironSparkStepDefs);

export function StepCatalogSetup() {
  return null;
}
