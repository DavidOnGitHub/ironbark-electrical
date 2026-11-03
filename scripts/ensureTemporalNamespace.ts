/**
 * Creates the Temporal namespace named by TEMPORAL_NAMESPACE if it does not exist yet, so a shared Temporal
 * server needs no manual setup. Safe to run on every deploy. Usage: pnpm temporal:namespace
 */
import { getTemporalClient } from "@kabosh-digital/workflow-temporal/client";

const GRPC_ALREADY_EXISTS = 6;
const RETENTION_DAYS = 3;

const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
if (namespace === "default") {
  console.log('TEMPORAL_NAMESPACE is "default": nothing to create.');
  process.exit(0);
}

const client = await getTemporalClient();
type RegisterRequest = Parameters<typeof client.connection.workflowService.registerNamespace>[0];
try {
  await client.connection.workflowService.registerNamespace({
    namespace,
    // The protobuf type wants a Long; the encoder accepts a plain number (and `long` is not a direct dependency).
    workflowExecutionRetentionPeriod: { seconds: RETENTION_DAYS * 24 * 60 * 60 } as unknown as RegisterRequest["workflowExecutionRetentionPeriod"],
  });
  console.log(`Created Temporal namespace "${namespace}" (retention ${RETENTION_DAYS} days).`);
} catch (err) {
  if ((err as { code?: number }).code !== GRPC_ALREADY_EXISTS) throw err;
  console.log(`Temporal namespace "${namespace}" already exists.`);
}
await client.connection.close();
