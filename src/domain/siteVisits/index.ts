/**
 * Site visits module - the public API: an electrician looks at the job before it is quoted.
 * Booking one moves the request to "Site visit booked"; the technician records what they found,
 * and the quote starts from that. History is written on the request's timeline. A technician's
 * functions take their user id and only ever see or change their own visits, never only the UI.
 */
import { z } from "zod";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import { canTransition, changeStatus } from "../requests";
import type { Actor } from "../shared/actor";
import { findConflicts } from "../jobs";
import { formatDayTime, startOfDay } from "../../lib/tz";

import { SITE_VISIT_STATUS_LABEL } from "./status";

export * from "./status";

export class SiteVisitConflictError extends Error {}
export class SiteVisitAccessError extends Error {}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();

/** Booked visits of this technician that overlap the window. */
async function visitConflicts(userId: string, start: Date, end: Date, excludeId?: string) {
  const rows = await appDb.siteVisit.findMany({
    where: { assignedUserId: userId, status: "SCHEDULED", scheduledStart: { lt: end }, scheduledEnd: { gt: start }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, scheduledStart: true, scheduledEnd: true, request: { select: { summary: true } } },
  });
  return rows.filter((v) => overlaps(start, end, v.scheduledStart, v.scheduledEnd));
}

export const BookVisitSchema = z
  .object({ assignedUserId: z.string().min(1, "Choose a technician"), start: z.date(), end: z.date(), allowConflict: z.boolean().default(false) })
  .refine((v) => v.end.getTime() > v.start.getTime(), { message: "The end must be after the start", path: ["end"] })
  .refine((v) => v.end.getTime() - v.start.getTime() <= 8 * 3_600_000, { message: "A site visit cannot be longer than 8 hours", path: ["end"] });
export type BookVisitInput = z.input<typeof BookVisitSchema>;

/** Books a visit for an enquiry, or moves its booked visit to a new time. */
export async function bookSiteVisit(requestId: string, input: BookVisitInput, actor: Actor, techLabel: string) {
  const v = BookVisitSchema.parse(input);
  const request = await appDb.request.findUniqueOrThrow({ where: { id: requestId } });
  if (!request.clientId) throw new Error("Link this enquiry to a client before booking a visit.");
  if (!["NEW", "CONTACTED", "SITE_VISIT_BOOKED"].includes(request.status)) {
    throw new Error("A site visit can only be booked for an enquiry that has not been quoted yet.");
  }
  const existing = await appDb.siteVisit.findFirst({ where: { requestId, status: "SCHEDULED" } });
  const [jobs, visits] = await Promise.all([findConflicts(v.assignedUserId, v.start, v.end), visitConflicts(v.assignedUserId, v.start, v.end, existing?.id)]);
  const clashes = [...jobs.map((j) => `${j.number} (${j.title})`), ...visits.map((s) => `a site visit (${s.request.summary})`)];
  if (clashes.length > 0 && !v.allowConflict) throw new SiteVisitConflictError(`${techLabel} already has ${clashes.join(", ")} in that time.`);

  const visit = await appDb.$transaction(async (tx) => {
    const data = { assignedUserId: v.assignedUserId, scheduledStart: v.start, scheduledEnd: v.end };
    const saved = existing ? await tx.siteVisit.update({ where: { id: existing.id }, data }) : await tx.siteVisit.create({ data: { requestId, ...data } });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: requestId,
      clientId: request.clientId,
      kind: existing ? "UPDATED" : "SCHEDULED",
      summary: `Site visit ${existing ? "moved to" : "booked for"} ${formatDayTime(v.start)} with ${techLabel}`,
      body: clashes.length ? `Booked over: ${clashes.join(", ")}` : null,
    });
    return saved;
  });
  if (canTransition(request.status, "SITE_VISIT_BOOKED")) await changeStatus(requestId, "SITE_VISIT_BOOKED", {}, actor);
  return visit;
}

/** Records the technician's findings and marks the visit done. With `technicianUserId` the caller is a technician and must be the one booked. */
export async function completeSiteVisit(visitId: string, findings: string, actor: Actor, opts: { technicianUserId?: string } = {}) {
  const text = z.string().trim().min(1, "Write what you found").max(4000).parse(findings);
  return appDb.$transaction(async (tx) => {
    const current = await tx.siteVisit.findUniqueOrThrow({ where: { id: visitId }, include: { request: { select: { summary: true, clientId: true } } } });
    if (opts.technicianUserId !== undefined && current.assignedUserId !== opts.technicianUserId) throw new SiteVisitAccessError("This visit is not assigned to you.");
    if (current.status !== "SCHEDULED") throw new Error(`A visit that is ${SITE_VISIT_STATUS_LABEL[current.status].toLowerCase()} cannot be completed.`);
    const visit = await tx.siteVisit.update({ where: { id: visitId }, data: { status: "COMPLETED", findings: text, completedAt: new Date() } });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: current.requestId,
      clientId: current.request.clientId,
      kind: "UPDATED",
      summary: `Site visit done: ${current.request.summary}`,
      body: text,
    });
    return visit;
  });
}

/** Cancels a booked visit. The enquiry goes back to Contacted when no other visit is booked or done. */
export async function cancelSiteVisit(visitId: string, actor: Actor) {
  const visit = await appDb.$transaction(async (tx) => {
    const current = await tx.siteVisit.findUniqueOrThrow({ where: { id: visitId }, include: { request: { select: { summary: true, clientId: true } } } });
    if (current.status !== "SCHEDULED") throw new Error(`A visit that is ${SITE_VISIT_STATUS_LABEL[current.status].toLowerCase()} cannot be cancelled.`);
    const saved = await tx.siteVisit.update({ where: { id: visitId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await recordActivity(tx, { actor, entityType: "request", entityId: current.requestId, clientId: current.request.clientId, kind: "UPDATED", summary: `Site visit cancelled: ${current.request.summary}` });
    return saved;
  });
  const request = await appDb.request.findUniqueOrThrow({ where: { id: visit.requestId }, select: { status: true } });
  const kept = await appDb.siteVisit.count({ where: { requestId: visit.requestId, status: { in: ["SCHEDULED", "COMPLETED"] } } });
  if (kept === 0 && request.status === "SITE_VISIT_BOOKED") await changeStatus(visit.requestId, "CONTACTED", {}, actor);
  return visit;
}

/** When each technician is committed to a booked site visit between two instants (for availability). */
export async function listBusyWindows(from: Date, to: Date) {
  const rows = await appDb.siteVisit.findMany({ where: { status: "SCHEDULED", scheduledStart: { lt: to }, scheduledEnd: { gt: from } }, select: { assignedUserId: true, scheduledStart: true, scheduledEnd: true } });
  return rows.map((r) => ({ userId: r.assignedUserId, start: r.scheduledStart, end: r.scheduledEnd }));
}

export async function getSiteVisit(id: string) {
  return appDb.siteVisit.findUnique({ where: { id }, include: { request: { select: { id: true, summary: true, description: true, clientId: true, siteId: true } } } });
}

export async function listVisitsForRequest(requestId: string) {
  return appDb.siteVisit.findMany({ where: { requestId }, orderBy: { scheduledStart: "desc" } });
}

/** The most recent finished visit for an enquiry - what the quote starts from. */
export async function latestCompletedVisit(requestId: string) {
  return appDb.siteVisit.findFirst({ where: { requestId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
}

const FIELD_SELECT = {
  id: true,
  status: true,
  assignedUserId: true,
  scheduledStart: true,
  scheduledEnd: true,
  findings: true,
  request: {
    select: {
      id: true,
      summary: true,
      description: true,
      category: true,
      urgency: true,
      client: { select: { name: true, phone: true } },
      site: { select: { line1: true, line2: true, suburb: true, state: true, postcode: true, accessNotes: true, switchboardNotes: true } },
    },
  },
} as const;

/** A technician's own visits from `fromDay` for `days` days (Sydney days), booked ones and those finished in the window. */
export async function listVisitsForTechnician(userId: string, fromDay: string, days = 8) {
  const from = startOfDay(fromDay);
  const to = new Date(from.getTime() + days * 86_400_000);
  return appDb.siteVisit.findMany({
    where: { assignedUserId: userId, status: { in: ["SCHEDULED", "COMPLETED"] }, scheduledStart: { gte: from, lt: to } },
    orderBy: { scheduledStart: "asc" },
    select: FIELD_SELECT,
  });
}

/** The week's booked and finished visits, any technician, for the schedule. */
export async function weekVisits(weekStartDay: string, days = 7) {
  const from = startOfDay(weekStartDay);
  const to = new Date(from.getTime() + days * 86_400_000);
  return appDb.siteVisit.findMany({
    where: { status: { in: ["SCHEDULED", "COMPLETED"] }, scheduledStart: { gte: from, lt: to } },
    orderBy: { scheduledStart: "asc" },
    include: { request: { select: { id: true, summary: true, client: { select: { name: true } }, site: { select: { suburb: true } } } } },
  });
}
