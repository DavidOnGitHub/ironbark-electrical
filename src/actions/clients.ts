"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import {
  addNote,
  addSite,
  createClient,
  findPossibleDuplicates,
  parseTags,
  setClientArchived,
  updateClient,
  updateSite,
} from "../domain/clients";
import { errorMessage, text, type ActionState } from "./shared";

function clientFields(formData: FormData) {
  return {
    type: text(formData, "type") ?? "PERSON",
    name: text(formData, "name") ?? "",
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    preferredContact: text(formData, "preferredContact") ?? "EMAIL",
    tags: parseTags(text(formData, "tags")),
    notes: text(formData, "notes"),
  } as Parameters<typeof createClient>[0];
}

function siteFields(formData: FormData) {
  return {
    label: text(formData, "label"),
    line1: text(formData, "line1") ?? "",
    line2: text(formData, "line2"),
    suburb: text(formData, "suburb") ?? "",
    state: text(formData, "state") ?? "NSW",
    postcode: text(formData, "postcode") ?? "",
    accessNotes: text(formData, "accessNotes"),
    switchboardNotes: text(formData, "switchboardNotes"),
  } as Parameters<typeof addSite>[1];
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  let clientId: string;
  try {
    const input = clientFields(formData);
    if (text(formData, "ignoreDuplicates") !== "yes") {
      const duplicates = await findPossibleDuplicates({ email: input.email, phone: input.phone });
      if (duplicates.length > 0) return { error: null, duplicates };
    }
    const client = await createClient(input, userActor(user));
    clientId = client.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  const clientId = text(formData, "clientId");
  if (!clientId) return { error: "Missing client." };
  try {
    await updateClient(clientId, clientFields(formData), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  return { error: null, ok: true };
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  const clientId = text(formData, "clientId");
  if (!clientId) return;
  await setClientArchived(clientId, text(formData, "archived") === "yes", userActor(user));
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

export async function addSiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  const clientId = text(formData, "clientId");
  if (!clientId) return { error: "Missing client." };
  try {
    await addSite(clientId, siteFields(formData), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/clients/${clientId}`);
  return { error: null, ok: true };
}

export async function updateSiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  const siteId = text(formData, "siteId");
  const clientId = text(formData, "clientId");
  if (!siteId || !clientId) return { error: "Missing site." };
  try {
    await updateSite(siteId, siteFields(formData), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/clients/${clientId}`);
  return { error: null, ok: true };
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.CLIENTS_WRITE);
  const clientId = text(formData, "clientId");
  if (!clientId) return { error: "Missing client." };
  try {
    await addNote(clientId, text(formData, "body") ?? "", userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/clients/${clientId}`);
  return { error: null, ok: true };
}
