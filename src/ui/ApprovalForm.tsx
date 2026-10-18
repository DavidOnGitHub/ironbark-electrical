"use client";

import { useActionState } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Label } from "@kabosh-digital/m-street-kit/ui/label";
import { Textarea } from "@kabosh-digital/m-street-kit/ui/textarea";
import { completeApprovalAction } from "../actions/approvals";
import type { ActionState } from "../actions/shared";

/** Approve as it is, edit the message first, or reject. Approving sends whatever is in the box. */
export function ApprovalForm({ taskId, instanceId, nodeId, draft, hint }: { taskId: string; instanceId: string; nodeId: string; draft: string; hint: string | null }) {
  const [state, formAction, pending] = useActionState(completeApprovalAction, { error: null } as ActionState);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3" data-testid="approval-form">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <input type="hidden" name="nodeId" value={nodeId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`message-${taskId}`}>Message (edit it if you like)</Label>
        <Textarea id={`message-${taskId}`} name="message" rows={8} defaultValue={draft} className="bg-card" data-testid="approval-message" />
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" name="approval" value="approve" size="sm" disabled={pending} className="bg-teal-accent text-teal-accent-foreground hover:bg-teal-accent/90">
          Approve and send
        </Button>
        <Button type="submit" name="approval" value="reject" size="sm" variant="outline" disabled={pending} className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
          Reject
        </Button>
        {pending ? <span className="text-xs text-muted-foreground">Sending...</span> : null}
      </div>
      {state.error ? <p role="alert" className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
