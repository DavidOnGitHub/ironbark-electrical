import type { currentActor } from "@kabosh-digital/m-street-kit/auth";

/**
 * Who sees which workflow runs and their data, for Ironbark's own pages that
 * read workflow tables directly (the Tasks page). Mirrors the kit's rules in
 * m-street-kit src/lib/access.ts (visibleWorkflowFilter, canSeeRunData) using
 * the access `currentActor()` already loaded, so these pages follow workflow
 * sharing like the console's own pages do. Keep in step with the kit; replace
 * with a kit export if one is added.
 */
export type WorkflowViewer = NonNullable<Awaited<ReturnType<typeof currentActor>>>;
type Actor = WorkflowViewer;
type Workflow = { id: string; ownerId: string | null };

const isAdmin = (actor: Actor) => actor.roles.includes("ADMIN");

/** Prisma `where` for the workflow definitions this person can see. */
export function visibleWorkflows(actor: Actor) {
  if (isAdmin(actor) || actor.access.permissions.has("workflows.view_all")) return {};
  return { OR: [{ ownerId: actor.id }, { id: { in: [...actor.access.workflowGrants.keys()] } }] };
}

/** Whether this person may see a run's data (context, task details) for a workflow they can see. */
export function canSeeRunData(actor: Actor, workflow: Workflow) {
  if (isAdmin(actor) || workflow.ownerId === actor.id) return true;
  if (actor.access.permissions.has("runs.view_data_all")) return true;
  return actor.access.workflowGrants.get(workflow.id)?.runData ?? false;
}

/** No group set = anyone; otherwise someone in that group (a role, or a custom group's key), or an administrator. */
export function canCompleteTask(actor: Actor, task: { assigneeRole: string | null; assigneeId: string | null }) {
  if (task.assigneeId) return task.assigneeId === actor.id;
  const role = task.assigneeRole;
  return !role || isAdmin(actor) || (actor.roles as string[]).includes(role) || actor.access.groupKeys.includes(role);
}
