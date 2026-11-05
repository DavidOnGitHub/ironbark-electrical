"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { getItRequest, IT_STATUS_LABEL, listItRequests, submitItRequest, syncItRequest, waitingOnPerson, type ItStatusValue } from "../domain/it";
import { errorMessage } from "./shared";

/** What the assistant panel shows for one request. */
export interface ItRequestView {
  id: string;
  number: string;
  title: string;
  kind: "FEATURE" | "ERROR" | "FINDING";
  status: ItStatusValue;
  statusLabel: string;
  /** What the person has to do next, when it is on them. */
  waiting: string | null;
  previewUrl: string | null;
  requestedBy: string;
  createdAt: string;
  failed: boolean;
}

const view = (r: Awaited<ReturnType<typeof listItRequests>>[number]): ItRequestView => ({
  id: r.id,
  number: r.number,
  title: r.title,
  kind: r.kind,
  status: r.status,
  statusLabel: IT_STATUS_LABEL[r.status],
  waiting: waitingOnPerson(r.status),
  previewUrl: r.previewUrl,
  requestedBy: r.requestedByLabel,
  createdAt: r.createdAt.toISOString(),
  failed: r.status === "FAILED" || r.status === "BUILD_FAILED",
});

/** Owner and Office see every request; everyone else sees their own. */
export async function listItRequestsAction(): Promise<ItRequestView[]> {
  const user = await requireRole(Access.IT_ASK);
  const all = await listItRequests({ limit: 50 });
  const manage = Access.IT_MANAGE.some((role) => user.roles.includes(role));
  return all.filter((r) => manage || r.requestedByUserId === user.id).map(view);
}

export async function submitItRequestAction(input: { title: string; description: string; page?: string }): Promise<{ error: string | null; request?: ItRequestView }> {
  const user = await requireRole(Access.IT_ASK);
  try {
    const { request } = await submitItRequest(
      {
        kind: "FEATURE",
        title: input.title,
        description: input.description,
        context: input.page ? { page: input.page.slice(0, 200), roles: user.roles } : { roles: user.roles },
      },
      { actor: userActor(user), email: user.email },
    );
    return { error: null, request: view(request) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** Refreshes one request from AI Builder, for the panel's refresh button. Own requests only, unless Owner or Office. */
export async function refreshItRequestAction(id: string): Promise<ItRequestView | null> {
  const user = await requireRole(Access.IT_ASK);
  const row = await getItRequest(id);
  const manage = Access.IT_MANAGE.some((role) => user.roles.includes(role));
  if (!row || (!manage && row.requestedByUserId !== user.id)) return null;
  const updated = await syncItRequest(id);
  return updated ? view(updated) : null;
}
