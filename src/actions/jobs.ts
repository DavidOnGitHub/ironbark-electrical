"use server";

import { revalidatePath } from "next/cache";
import { prisma, UserRole } from "@kabosh-digital/workflow-schema";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import {
  addJobNote,
  approveVariation,
  changeJobStatus,
  JobAccessError,
  scheduleJob,
  ScheduleConflictError,
  unscheduleJob,
  type JobStatusValue,
  JOB_STATUS_ORDER,
} from "../domain/jobs";
import { parseMoney } from "../lib/money";
import { sydneyLocalToDate } from "../lib/tz";
import { errorMessage, text, type ActionState } from "./shared";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/schedule");
  revalidatePath("/my-day");
  revalidatePath("/");
}

export async function scheduleJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.JOBS_WRITE);
  const jobId = text(formData, "jobId");
  const techId = text(formData, "assignedUserId");
  const start = sydneyLocalToDate(text(formData, "start") ?? "");
  const end = sydneyLocalToDate(text(formData, "end") ?? "");
  if (!jobId) return { error: "Missing job." };
  if (!techId) return { error: "Choose a technician." };
  if (!start || !end) return { error: "Enter a start and end time." };
  try {
    // Only a real technician can be booked (the business tables hold a plain user id).
    const tech = await prisma.user.findFirst({ where: { id: techId, roles: { has: UserRole.OPERATOR } }, select: { name: true, email: true } });
    if (!tech) return { error: "That person is not a technician." };
    await scheduleJob(jobId, { assignedUserId: techId, start, end, allowConflict: text(formData, "allowConflict") === "yes" }, userActor(user), tech.name?.trim() || tech.email);
  } catch (err) {
    if (err instanceof ScheduleConflictError) return { error: err.message, conflict: true };
    return { error: errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}

export async function unscheduleJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.JOBS_WRITE);
  const jobId = text(formData, "jobId");
  if (!jobId) return { error: "Missing job." };
  try {
    await unscheduleJob(jobId, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}

export async function changeJobStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.JOBS_WRITE);
  const jobId = text(formData, "jobId");
  const to = text(formData, "to") as JobStatusValue | undefined;
  if (!jobId || !to || !JOB_STATUS_ORDER.includes(to)) return { error: "Choose a status." };
  try {
    await changeJobStatus(jobId, to, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}

export async function addJobNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.JOBS_WRITE);
  const jobId = text(formData, "jobId");
  if (!jobId) return { error: "Missing job." };
  try {
    const kind = text(formData, "kind") === "VARIATION" ? "VARIATION" : "NOTE";
    const extra = parseMoney(text(formData, "extra"));
    await addJobNote(jobId, { text: text(formData, "text") ?? "", kind, extraCents: extra ?? undefined }, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}

export async function approveVariationAction(formData: FormData): Promise<void> {
  const user = await requireRole(Access.JOBS_WRITE);
  const noteId = text(formData, "noteId");
  const jobId = text(formData, "jobId");
  if (!noteId || !jobId) return;
  await approveVariation(noteId, text(formData, "approved") === "yes", userActor(user));
  refresh(jobId);
}

// --- the field: a technician's own jobs only (enforced again inside the jobs module)

export async function fieldChangeStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.FIELD);
  const jobId = text(formData, "jobId");
  const to = text(formData, "to") as JobStatusValue | undefined;
  if (!jobId || !to || !JOB_STATUS_ORDER.includes(to)) return { error: "Choose a status." };
  try {
    await changeJobStatus(jobId, to, userActor(user), { technicianUserId: user.id });
  } catch (err) {
    return { error: err instanceof JobAccessError ? err.message : errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}

export async function fieldAddNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.FIELD);
  const jobId = text(formData, "jobId");
  if (!jobId) return { error: "Missing job." };
  try {
    const kind = text(formData, "kind") === "VARIATION" ? "VARIATION" : "NOTE";
    const extra = parseMoney(text(formData, "extra"));
    await addJobNote(jobId, { text: text(formData, "text") ?? "", kind, extraCents: extra ?? undefined }, userActor(user), { technicianUserId: user.id });
  } catch (err) {
    return { error: err instanceof JobAccessError ? err.message : errorMessage(err) };
  }
  refresh(jobId);
  return { error: null, ok: true };
}
