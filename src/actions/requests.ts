"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, UserRole } from "@kabosh-digital/workflow-schema";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import type { RequestStatus } from "ironbark-electrical-client";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import {
  assignOwner,
  changeStatus,
  createClientFromRequest,
  createRequest,
  linkClient,
  REQUEST_STATUS_ORDER,
} from "../domain/requests";
import { errorMessage, text, type ActionState } from "./shared";

export async function createRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  let id: string;
  try {
    const request = await createRequest(
      {
        source: (text(formData, "source") ?? "MANUAL") as "MANUAL",
        category: (text(formData, "category") ?? "OTHER") as "OTHER",
        urgency: (text(formData, "urgency") ?? "ROUTINE") as "ROUTINE",
        summary: text(formData, "summary") ?? "",
        description: text(formData, "description"),
        clientId: text(formData, "clientId"),
        siteId: text(formData, "siteId"),
        contactName: text(formData, "contactName"),
        contactEmail: text(formData, "contactEmail"),
        contactPhone: text(formData, "contactPhone"),
        ownerUserId: user.id,
      },
      userActor(user),
    );
    id = request.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/requests");
  redirect(`/requests/${id}`);
}

export async function changeRequestStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const id = text(formData, "requestId");
  const to = text(formData, "to") as RequestStatus | undefined;
  if (!id || !to || !REQUEST_STATUS_ORDER.includes(to)) return { error: "Choose a status." };
  try {
    await changeStatus(id, to, { lostReason: text(formData, "lostReason") }, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/");
  return { error: null, ok: true };
}

export async function assignRequestOwnerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const id = text(formData, "requestId");
  const ownerId = text(formData, "ownerUserId") || null;
  if (!id) return { error: "Missing request." };
  try {
    let label: string | null = null;
    if (ownerId) {
      // Only Owner and Office users may own a request; validated here because the
      // business tables hold a plain id with no foreign key to the platform's users.
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, roles: { hasSome: [UserRole.ADMIN, UserRole.EDITOR] } },
        select: { name: true, email: true },
      });
      if (!owner) return { error: "That person cannot own requests." };
      label = owner.name?.trim() || owner.email;
    }
    await assignOwner(id, ownerId, label, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  return { error: null, ok: true };
}

export async function linkRequestClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const id = text(formData, "requestId");
  const clientId = text(formData, "clientId");
  if (!id || !clientId) return { error: "Choose a client." };
  try {
    await linkClient(id, clientId, text(formData, "siteId") || null, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/requests/${id}`);
  return { error: null, ok: true };
}

export async function createClientFromRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const id = text(formData, "requestId");
  if (!id) return { error: "Missing request." };
  try {
    await createClientFromRequest(id, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath("/clients");
  return { error: null, ok: true };
}
