import Link from "next/link";
import { auth, redirectIfMfaPending } from "@kabosh-digital/m-street-kit/auth";
import { CompleteTaskForm } from "@kabosh-digital/m-street-kit/components/CompleteTaskForm";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { prisma } from "@kabosh-digital/workflow-schema";
import { parseHumanTaskOutputFields } from "@kabosh-digital/workflow-types";
import { reviewForTask } from "../../src/domain/approvals";
import { PageHeader } from "../../src/ui/fields";
import { TaskReview } from "../../src/ui/TaskReview";

export const dynamic = "force-dynamic";

const assigneeRoleOf = (input: unknown) => {
  const r = (input as { assigneeRole?: unknown } | null)?.assigneeRole;
  return typeof r === "string" ? r : null;
};

/** Same rule as the console: no role set = anyone; otherwise someone holding that role, or an administrator. */
function canComplete(user: { id: string; roles: string[] }, task: { input: unknown; assigneeId: string | null }) {
  if (task.assigneeId) return task.assigneeId === user.id;
  const role = assigneeRoleOf(task.input);
  return !role || user.roles.includes(role) || user.roles.includes("ADMIN");
}

/** The console's Tasks page, plus the content of each approval: for an email step, the email itself. */
export default async function TasksPage() {
  await redirectIfMfaPending("/tasks");
  const session = await auth();
  const user = session?.user?.id ? { id: session.user.id, roles: (session.user.roles ?? []) as string[] } : null;
  const tasks = user
    ? await prisma.workflowTask.findMany({
        where: { status: "PENDING", ...(user.roles.includes("ADMIN") ? {} : { instance: { definition: { ownerId: user.id } } }) },
        include: { instance: { include: { definition: { select: { name: true, graph: true, publishedGraph: true } } } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const rows = await Promise.all(
    tasks.map(async (t) => {
      const graph = ((t.instance.definition.publishedGraph ?? t.instance.definition.graph) as { nodes?: { id: string; label?: string }[] } | null) ?? {};
      return { task: t, label: graph.nodes?.find((n) => n.id === t.nodeId)?.label ?? t.nodeId, review: await reviewForTask(t) };
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tasks" subtitle="Runs waiting for a person. For an approval, what you are approving is shown below." />
      {rows.length === 0 ? <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No pending tasks. Nothing is waiting on a person right now.</p> : null}
      <ul className="flex flex-col gap-4">
        {rows.map(({ task, label, review }) => (
          <li key={task.id} className="rounded-md border border-l-4 border-l-hivis bg-card p-4" data-testid="task-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold">{label}</p>
                <p className="text-sm text-muted-foreground">{task.instance.definition.name} &middot; waiting since {formatRelativeTime(task.createdAt)}</p>
                {(task.input as { description?: string } | null)?.description ? <p className="mt-1 max-w-3xl text-sm">{(task.input as { description: string }).description}</p> : null}
              </div>
              <Link href={`/instances/${task.instanceId}`} className="text-sm font-semibold text-link hover:underline">View run &rarr;</Link>
            </div>
            {review ? <TaskReview review={review} /> : null}
            <CompleteTaskForm
              taskId={task.id}
              instanceId={task.instanceId}
              nodeId={task.nodeId}
              canComplete={!!user && canComplete(user, task)}
              assigneeRole={assigneeRoleOf(task.input)}
              approval={(task.input as { approval?: unknown } | null)?.approval === true}
              outputFields={parseHumanTaskOutputFields(task.input)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
