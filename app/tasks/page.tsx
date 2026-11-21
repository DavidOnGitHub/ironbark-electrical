import Link from "next/link";
import { currentActor, redirectIfMfaPending } from "@kabosh-digital/m-street-kit/auth";
import { CompleteTaskForm } from "@kabosh-digital/m-street-kit/components/CompleteTaskForm";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { prisma } from "@kabosh-digital/workflow-schema";
import { parseHumanTaskOutputFields } from "@kabosh-digital/workflow-types";
import { editableForTask, reviewForTask } from "../../src/domain/approvals";
import { canCompleteTask, canSeeRunData, visibleWorkflows } from "../../src/lib/workflowAccess";
import { PageHeader } from "../../src/ui/fields";
import { ApprovalForm } from "../../src/ui/ApprovalForm";
import { TaskReview } from "../../src/ui/TaskReview";

export const dynamic = "force-dynamic";

const assigneeRoleOf = (input: unknown) => {
  const r = (input as { assigneeRole?: unknown } | null)?.assigneeRole;
  return typeof r === "string" ? r : null;
};

/**
 * The console's Tasks page, plus the content of each approval: for an email step, the email itself. Same rules as the
 * console: tasks on workflows the person can see (their own and those shared with them), and a task's details only
 * with the workflow's run data or when it is theirs to complete.
 */
export default async function TasksPage() {
  await redirectIfMfaPending("/tasks");
  const actor = await currentActor();
  const tasks = actor
    ? await prisma.workflowTask.findMany({
        where: { status: "PENDING", instance: { definition: visibleWorkflows(actor) } },
        include: { instance: { include: { definition: { select: { name: true, graph: true, publishedGraph: true, ownerId: true } } } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const rows = await Promise.all(
    tasks.map(async (t) => {
      const graph = ((t.instance.definition.publishedGraph ?? t.instance.definition.graph) as { nodes?: { id: string; label?: string }[] } | null) ?? {};
      const label = graph.nodes?.find((n) => n.id === t.nodeId)?.label ?? t.nodeId;
      const canComplete = !!actor && canCompleteTask(actor, { assigneeRole: assigneeRoleOf(t.input), assigneeId: t.assigneeId });
      const details = canComplete || (!!actor && canSeeRunData(actor, { id: t.instance.definitionId, ownerId: t.instance.definition.ownerId }));
      if (!details) return { task: t, label, canComplete, details, review: null, editable: null };
      return { task: t, label, canComplete, details, review: await reviewForTask(t), editable: editableForTask(t) };
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tasks" subtitle="Runs waiting for a person. For an approval, what you are approving is shown below." />
      {rows.length === 0 ? <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No pending tasks. Nothing is waiting on a person right now.</p> : null}
      <ul className="flex flex-col gap-4">
        {rows.map(({ task, label, canComplete, details, review, editable }) => (
          <li key={task.id} className="rounded-md border border-l-4 border-l-hivis bg-card p-4" data-testid="task-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold">{label}</p>
                <p className="text-sm text-muted-foreground">{task.instance.definition.name} &middot; waiting since {formatRelativeTime(task.createdAt)}</p>
                {details && (task.input as { description?: string } | null)?.description ? <p className="mt-1 max-w-3xl text-sm">{(task.input as { description: string }).description}</p> : null}
                {details ? null : <p className="mt-1 text-sm text-muted-foreground">Details are hidden: this workflow is shared with you without its run data.</p>}
              </div>
              <Link href={`/instances/${task.instanceId}`} className="text-sm font-semibold text-link hover:underline">View run &rarr;</Link>
            </div>
            {review ? <TaskReview review={review} /> : null}
            {editable && canComplete ? (
              <ApprovalForm taskId={task.id} instanceId={task.instanceId} nodeId={task.nodeId} draft={editable.text} hint={editable.hint} />
            ) : (
            <CompleteTaskForm
              taskId={task.id}
              instanceId={task.instanceId}
              nodeId={task.nodeId}
              canComplete={canComplete}
              assigneeRole={assigneeRoleOf(task.input)}
              approval={(task.input as { approval?: unknown } | null)?.approval === true}
              outputFields={parseHumanTaskOutputFields(task.input)}
            />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
