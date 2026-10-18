"use server";

import { revalidatePath } from "next/cache";
import { prisma, UserRole } from "@kabosh-digital/workflow-schema";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { bookSiteVisit, cancelSiteVisit, completeSiteVisit, SiteVisitAccessError, SiteVisitConflictError } from "../domain/siteVisits";
import { sydneyLocalToDate } from "../lib/tz";
import { afterSiteVisitDone } from "../automation";
import { errorMessage, text, type ActionState } from "./shared";

function refresh(requestId?: string) {
  if (requestId) revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/schedule");
  revalidatePath("/my-day");
  revalidatePath("/");
}

export async function bookSiteVisitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const requestId = text(formData, "requestId");
  const techId = text(formData, "assignedUserId");
  const start = sydneyLocalToDate(text(formData, "start") ?? "");
  const end = sydneyLocalToDate(text(formData, "end") ?? "");
  if (!requestId) return { error: "Missing enquiry." };
  if (!techId) return { error: "Choose a technician." };
  if (!start || !end) return { error: "Enter a start and end time." };
  try {
    // Only a real technician can be booked (the business tables hold a plain user id).
    const tech = await prisma.user.findFirst({ where: { id: techId, roles: { has: UserRole.OPERATOR } }, select: { name: true, email: true } });
    if (!tech) return { error: "That person is not a technician." };
    await bookSiteVisit(requestId, { assignedUserId: techId, start, end, allowConflict: text(formData, "allowConflict") === "yes" }, userActor(user), tech.name?.trim() || tech.email);
  } catch (err) {
    if (err instanceof SiteVisitConflictError) return { error: err.message, conflict: true };
    return { error: errorMessage(err) };
  }
  refresh(requestId);
  return { error: null, ok: true };
}

export async function cancelSiteVisitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const visitId = text(formData, "visitId");
  if (!visitId) return { error: "Missing visit." };
  try {
    const visit = await cancelSiteVisit(visitId, userActor(user));
    refresh(visit.requestId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  return { error: null, ok: true };
}

/** The office records findings on a technician's behalf (for example after a phone call from site). */
export async function completeSiteVisitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.REQUESTS);
  const visitId = text(formData, "visitId");
  if (!visitId) return { error: "Missing visit." };
  try {
    const visit = await completeSiteVisit(visitId, text(formData, "findings") ?? "", userActor(user));
    await afterSiteVisitDone(visit.id); // the quote drafting automation (if published); a failure never undoes the visit
    refresh(visit.requestId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  return { error: null, ok: true };
}

// --- the field: a technician's own visits only (enforced again inside the module)

export async function fieldCompleteSiteVisitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.FIELD);
  const visitId = text(formData, "visitId");
  if (!visitId) return { error: "Missing visit." };
  try {
    const visit = await completeSiteVisit(visitId, text(formData, "findings") ?? "", userActor(user), { technicianUserId: user.id });
    await afterSiteVisitDone(visit.id);
    refresh(visit.requestId);
  } catch (err) {
    return { error: err instanceof SiteVisitAccessError ? err.message : errorMessage(err) };
  }
  return { error: null, ok: true };
}
