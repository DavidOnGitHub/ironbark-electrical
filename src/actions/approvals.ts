"use server";

import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@kabosh-digital/workflow-schema";
import { requireUser } from "@kabosh-digital/m-street-kit/auth";
import { signalCompleteTask } from "@kabosh-digital/workflow-temporal/client";
import { approvalOutput } from "../domain/approvals/edit";
import { errorMessage, text, type ActionState } from "./shared";

/**
 * Approve (optionally with the message rewritten) or reject an approval task. The same rules as the console's own
 * completion: the task row is checked against the signed-in person, marked done BEFORE the run is signalled (the
 * signal is the step that cannot be taken back), and put back to pending if the signal fails.
 */
export async function completeApprovalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const taskId = text(formData, "taskId") ?? "";
  const instanceId = text(formData, "instanceId") ?? "";
  const nodeId = text(formData, "nodeId") ?? "";
  const user = await requireUser();
  try {
    const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
    if (!task) return { error: "Task not found." };
    if (task.status !== "PENDING") return { error: "Task is no longer pending." };
    if (task.instanceId !== instanceId || task.nodeId !== nodeId) return { error: "Task/instance/node mismatch - refresh and retry." };
    // Only runs the person may see; knowing a task id is not enough.
    const isAdmin = user.roles.includes("ADMIN" as never);
    const visible = await prisma.workflowInstance.findFirst({ where: { id: instanceId, ...(isAdmin ? {} : { definition: { ownerId: user.id } }) }, select: { id: true } });
    if (!visible) return { error: "Task not found." };
    const input = task.input as { assigneeRole?: string | null; approval?: unknown } | null;
    // Same rule as the console: a task for a person is theirs alone; otherwise no role set = anyone, else that role or an administrator.
    const allowed = task.assigneeId ? task.assigneeId === user.id : !input?.assigneeRole || user.roles.includes(input.assigneeRole as never) || isAdmin;
    if (!allowed) {
      return { error: `Forbidden: this task requires role ${input?.assigneeRole ?? "assigned"} (ADMIN can override).` };
    }
    if (input?.approval !== true) return { error: "This task is not an approval." };

    const outcome = approvalOutput(task.input, text(formData, "approval"), text(formData, "message"));
    if (!outcome.ok) return { error: outcome.error };

    await prisma.workflowTask.update({ where: { id: taskId }, data: { status: "COMPLETED", output: outcome.output as Prisma.InputJsonValue, completedAt: new Date() } });
    try {
      await signalCompleteTask(instanceId, nodeId, outcome.output);
    } catch (err) {
      await prisma.workflowTask.update({ where: { id: taskId }, data: { status: "PENDING", output: Prisma.JsonNull, completedAt: null } }).catch(() => undefined);
      throw err;
    }
    await prisma.auditLog
      .create({ data: { instanceId, nodeId, event: "task_completed", payload: { actorId: user.id, actorEmail: user.email, taskId, assigneeRole: input?.assigneeRole ?? null, edited: Object.keys(outcome.output).length > 1 } as Prisma.InputJsonValue } })
      .catch((err) => console.warn("[completeApprovalAction] audit write failed", err));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/instances/${instanceId}`);
  revalidatePath("/tasks");
  return { error: null, ok: true };
}
