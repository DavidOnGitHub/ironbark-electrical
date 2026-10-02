import { prisma, Prisma } from "@kabosh-digital/workflow-schema";
import { ironSparkWorkflows, wireConnectors } from "../src/workflows";

/** Puts the four workflows into the platform's tables, wiring the Gmail connector if one is connected. */
export async function seedWorkflows(opts: { publish?: boolean } = {}) {
  const owner = await prisma.user.findUnique({ where: { email: "owner@ironbark.test" }, select: { id: true } });
  const gmail = await prisma.connector.findFirst({ where: { type: "EMAIL" }, orderBy: { createdAt: "asc" }, select: { id: true, config: true } });
  const done: { name: string; published: boolean }[] = [];
  for (const base of ironSparkWorkflows) {
    const graph = wireConnectors(base, { emailConnectorId: gmail?.id, gmailAccount: (gmail?.config as { fromAddress?: string } | null)?.fromAddress });
    const data = {
      name: graph.name,
      graph: graph as unknown as Prisma.InputJsonValue,
      ...(opts.publish
        ? { status: "PUBLISHED" as const, version: 1, publishedGraph: { ...graph, status: "PUBLISHED" } as unknown as Prisma.InputJsonValue, publishedVersion: 1, triggerEnabledAt: new Date() }
        : { status: "DRAFT" as const, version: 1, publishedGraph: Prisma.DbNull, publishedVersion: null }),
    };
    await prisma.workflowDefinition.upsert({ where: { id: graph.id }, create: { id: graph.id, ownerId: owner?.id ?? null, ...data }, update: data });
    done.push({ name: graph.name, published: !!opts.publish });
  }
  return { done, gmailConnected: !!gmail };
}

/** Cancels any automation runs still going and clears their records (a demo reset starts clean). */
export async function clearAutomationRuns() {
  const { cancelWorkflowInstance } = await import("@kabosh-digital/workflow-temporal/client");
  const running = await prisma.workflowInstance.findMany({ where: { definitionId: { startsWith: "def_ironspark_" }, status: "RUNNING" }, select: { id: true } });
  for (const r of running) await cancelWorkflowInstance(r.id).catch(() => undefined);
  await prisma.workflowTask.deleteMany({ where: { instance: { definitionId: { startsWith: "def_ironspark_" } } } });
  const { count } = await prisma.workflowInstance.deleteMany({ where: { definitionId: { startsWith: "def_ironspark_" } } });
  return { cancelled: running.length, removed: count };
}
