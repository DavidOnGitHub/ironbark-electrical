import { prisma } from "@kabosh-digital/workflow-schema";
import { renderTemplate } from "../emailTemplates";
import { buildReview, type GraphNode, type Review } from "./review";

export { buildReview, type Review } from "./review";

type Json = Record<string, unknown> | null;

/** The review for a pending approval task, from its definition's graph and its run's progress so far. */
export async function reviewForTask(task: { input: unknown; instance: { context: unknown; definition: { graph: unknown; publishedGraph: unknown } } }): Promise<Review | null> {
  const reviewsNodeId = (task.input as { reviewsNodeId?: unknown } | null)?.reviewsNodeId;
  if (typeof reviewsNodeId !== "string") return null;
  const def = task.instance.definition;
  const graph = ((def.publishedGraph ?? def.graph) as { nodes?: GraphNode[] } | null) ?? {};
  const context = ((task.instance.context ?? {}) as Json) ?? {};
  return buildReview(graph.nodes ?? [], reviewsNodeId, context, renderTemplate);
}

/** Pending approvals for one run (the run page shows what is being waited on). */
export async function reviewsForInstance(instanceId: string, viewer: { id: string; roles: string[] }) {
  const tasks = await prisma.workflowTask.findMany({
    // Same visibility as the console: an administrator sees every run, anyone else only runs of their own workflows.
    where: { instanceId, status: "PENDING", ...(viewer.roles.includes("ADMIN") ? {} : { instance: { definition: { ownerId: viewer.id } } }) },
    include: { instance: { include: { definition: { select: { graph: true, publishedGraph: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const out: { taskId: string; nodeId: string; review: Review }[] = [];
  for (const t of tasks) {
    const review = await reviewForTask(t);
    if (review) out.push({ taskId: t.id, nodeId: t.nodeId, review });
  }
  return out;
}
