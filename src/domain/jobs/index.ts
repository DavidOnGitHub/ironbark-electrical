/**
 * Jobs module - the public API: jobs created from approved quotes, scheduling,
 * the field status flow, notes and variations. Technician scoping lives here (a
 * technician's functions take their user id and only ever see or change their own
 * jobs), never only in the UI.
 */
import { z } from "zod";
import { appDb, type Db, type Prisma } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { startOfDay } from "../../lib/tz";
import {
  canMoveJob,
  JOB_STATUS_LABEL,
  technicianCanMoveJob,
  windowsOverlap,
  type JobStatusValue,
} from "./status";

export * from "./status";

async function nextJobNumber(tx: Db): Promise<string> {
  const row = await tx.sequence.upsert({ where: { key: "job" }, create: { key: "job", value: 2001 }, update: { value: { increment: 1 } } });
  return `J-${row.value}`;
}

export interface JobFromQuote {
  quoteId: string;
  clientId: string;
  siteId: string | null;
  title: string;
  scope: string | null;
  subtotalCents: number;
}

/** Called when a quote is approved; runs in the quote's transaction. */
export async function createJobFromQuote(input: JobFromQuote, actor: Actor, tx: Db = appDb) {
  const number = await nextJobNumber(tx);
  const job = await tx.job.create({
    data: {
      number,
      clientId: input.clientId,
      siteId: input.siteId,
      quoteId: input.quoteId,
      title: input.title,
      scope: input.scope,
      quotedSubtotalCents: input.subtotalCents,
    },
  });
  await recordActivity(tx, {
    actor,
    entityType: "job",
    entityId: job.id,
    clientId: job.clientId,
    kind: "CREATED",
    summary: `Job ${number} created from the approved quote: ${job.title}`,
  });
  return job;
}

export async function getJob(id: string) {
  return appDb.job.findUnique({
    where: { id },
    include: { client: true, site: true, quote: { select: { id: true, number: true, totalCents: true } }, notes: { orderBy: { createdAt: "desc" } } },
  });
}

export interface JobListFilter {
  status?: JobStatusValue;
  activeOnly?: boolean;
  assignedUserId?: string;
  clientId?: string;
  limit?: number;
}

export async function listJobs(filter: JobListFilter = {}) {
  const where: Prisma.JobWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.activeOnly ? { status: { in: ["UNSCHEDULED", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] } } : {}),
    ...(filter.assignedUserId ? { assignedUserId: filter.assignedUserId } : {}),
    ...(filter.clientId ? { clientId: filter.clientId } : {}),
  };
  return appDb.job.findMany({
    where,
    orderBy: [{ scheduledStart: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: filter.limit ?? 200,
    include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true, line1: true } } },
  });
}

export class ScheduleConflictError extends Error {
  constructor(
    message: string,
    public conflicts: { id: string; number: string; title: string; scheduledStart: Date; scheduledEnd: Date }[],
  ) {
    super(message);
  }
}

/** Other jobs of this technician that overlap the window. */
export async function findConflicts(userId: string, start: Date, end: Date, excludeJobId?: string) {
  const candidates = await appDb.job.findMany({
    where: {
      assignedUserId: userId,
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
      status: { in: ["SCHEDULED", "IN_PROGRESS", "ON_HOLD"] },
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
    select: { id: true, number: true, title: true, scheduledStart: true, scheduledEnd: true },
  });
  return candidates
    .filter((j) => j.scheduledStart && j.scheduledEnd && windowsOverlap(start, end, j.scheduledStart, j.scheduledEnd))
    .map((j) => ({ ...j, scheduledStart: j.scheduledStart!, scheduledEnd: j.scheduledEnd! }));
}

export const ScheduleInputSchema = z
  .object({ assignedUserId: z.string().min(1, "Choose a technician"), start: z.date(), end: z.date(), allowConflict: z.boolean().default(false) })
  .refine((v) => v.end.getTime() > v.start.getTime(), { message: "The end must be after the start", path: ["end"] })
  .refine((v) => v.end.getTime() - v.start.getTime() <= 24 * 3_600_000, { message: "A job slot cannot be longer than 24 hours", path: ["end"] });
export type ScheduleInput = z.input<typeof ScheduleInputSchema>;

export async function scheduleJob(jobId: string, input: ScheduleInput, actor: Actor, techLabel: string) {
  const v = ScheduleInputSchema.parse(input);
  const current = await appDb.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!["UNSCHEDULED", "SCHEDULED", "ON_HOLD"].includes(current.status)) {
    throw new Error(`A job that is ${JOB_STATUS_LABEL[current.status]} cannot be rescheduled.`);
  }
  const conflicts = await findConflicts(v.assignedUserId, v.start, v.end, jobId);
  if (conflicts.length > 0 && !v.allowConflict) {
    throw new ScheduleConflictError(`${techLabel} already has ${conflicts.map((c) => `${c.number} (${c.title})`).join(", ")} in that time.`, conflicts);
  }
  return appDb.$transaction(async (tx) => {
    const job = await tx.job.update({
      where: { id: jobId },
      data: { assignedUserId: v.assignedUserId, scheduledStart: v.start, scheduledEnd: v.end, status: "SCHEDULED" },
    });
    await recordActivity(tx, {
      actor,
      entityType: "job",
      entityId: jobId,
      clientId: job.clientId,
      kind: "SCHEDULED",
      summary: `${job.number} scheduled for ${techLabel}`,
      body: conflicts.length ? `Booked over: ${conflicts.map((c) => c.number).join(", ")}` : null,
    });
    return job;
  });
}

export async function unscheduleJob(jobId: string, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (current.status !== "SCHEDULED") throw new Error(`Only a scheduled job can be unscheduled (this one is ${JOB_STATUS_LABEL[current.status]}).`);
    const job = await tx.job.update({ where: { id: jobId }, data: { status: "UNSCHEDULED", assignedUserId: null, scheduledStart: null, scheduledEnd: null } });
    await recordActivity(tx, { actor, entityType: "job", entityId: jobId, clientId: job.clientId, kind: "UPDATED", summary: `${job.number} unscheduled` });
    return job;
  });
}

export class JobAccessError extends Error {}

/** Moves a job along its status flow. With `technicianUserId` the caller is a
 * technician: they must be assigned to the job and may only make field moves. */
export async function changeJobStatus(jobId: string, to: JobStatusValue, actor: Actor, opts: { technicianUserId?: string } = {}) {
  return appDb.$transaction(async (tx) => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (opts.technicianUserId !== undefined) {
      if (current.assignedUserId !== opts.technicianUserId) throw new JobAccessError("This job is not assigned to you.");
      if (!technicianCanMoveJob(current.status, to)) throw new Error(`You cannot move a ${JOB_STATUS_LABEL[current.status].toLowerCase()} job to ${JOB_STATUS_LABEL[to].toLowerCase()}.`);
    } else if (!canMoveJob(current.status, to)) {
      throw new Error(`A job that is ${JOB_STATUS_LABEL[current.status]} cannot move to ${JOB_STATUS_LABEL[to]}.`);
    }
    const now = new Date();
    const job = await tx.job.update({
      where: { id: jobId },
      data: { status: to, ...(to === "IN_PROGRESS" && !current.startedAt ? { startedAt: now } : {}), ...(to === "COMPLETED" ? { completedAt: now } : {}) },
    });
    await recordActivity(tx, {
      actor,
      entityType: "job",
      entityId: jobId,
      clientId: job.clientId,
      kind: "STATUS_CHANGED",
      summary: `${job.number}: ${JOB_STATUS_LABEL[current.status]} -> ${JOB_STATUS_LABEL[to]}`,
    });
    return job;
  });
}

export const JobNoteInputSchema = z.object({
  text: z.string().trim().min(1, "Write something first").max(2000),
  kind: z.enum(["NOTE", "VARIATION"]).default("NOTE"),
  /** Variations: extra labour/parts, ex GST. */
  extraCents: z.number().int().min(0).max(100_000_00).optional(),
});
export type JobNoteInput = z.input<typeof JobNoteInputSchema>;

export async function addJobNote(jobId: string, input: JobNoteInput, actor: Actor, opts: { technicianUserId?: string } = {}) {
  const v = JobNoteInputSchema.parse(input);
  if (v.kind === "VARIATION" && (v.extraCents === undefined || v.extraCents <= 0)) throw new Error("A variation needs the extra amount (ex GST).");
  const authorUserId = actor.type === "USER" ? actor.userId : actor.label;
  return appDb.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (opts.technicianUserId !== undefined && job.assignedUserId !== opts.technicianUserId) throw new JobAccessError("This job is not assigned to you.");
    const note = await tx.jobNote.create({
      data: { jobId, authorUserId, authorLabel: actor.label, kind: v.kind, text: v.text, extraCents: v.kind === "VARIATION" ? (v.extraCents ?? null) : null },
    });
    await recordActivity(tx, {
      actor,
      entityType: "job",
      entityId: jobId,
      clientId: job.clientId,
      kind: v.kind === "VARIATION" ? "VARIATION" : "NOTE",
      summary: v.kind === "VARIATION" ? `${job.number}: variation raised` : `${job.number}: note added`,
      body: v.text,
    });
    return note;
  });
}

export async function approveVariation(noteId: string, approved: boolean, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const existing = await tx.jobNote.findUniqueOrThrow({ where: { id: noteId }, include: { job: true } });
    if (existing.kind !== "VARIATION") throw new Error("Only a variation can be approved.");
    const note = await tx.jobNote.update({ where: { id: noteId }, data: { approved, approvedByUserId: approved && actor.type === "USER" ? actor.userId : null } });
    await recordActivity(tx, {
      actor,
      entityType: "job",
      entityId: existing.jobId,
      clientId: existing.job.clientId,
      kind: "VARIATION",
      summary: `${existing.job.number}: variation ${approved ? "approved" : "approval withdrawn"}`,
      body: existing.text,
    });
    return note;
  });
}

/** What a technician may see of a job: location and access details, never prices. */
const TECHNICIAN_JOB_SELECT = {
  id: true,
  number: true,
  title: true,
  scope: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  startedAt: true,
  client: { select: { name: true, phone: true } },
  site: { select: { line1: true, line2: true, suburb: true, state: true, postcode: true, accessNotes: true, switchboardNotes: true } },
  notes: { orderBy: { createdAt: "desc" as const }, select: { id: true, kind: true, text: true, authorLabel: true, createdAt: true, approved: true } },
} satisfies Prisma.JobSelect;

/** A technician's own jobs from `fromDay` for `days` days (Sydney days), plus anything they have in progress or on hold. */
export async function listJobsForTechnician(userId: string, fromDay: string, days = 8) {
  const from = startOfDay(fromDay);
  const to = new Date(from.getTime() + days * 86_400_000);
  return appDb.job.findMany({
    where: {
      assignedUserId: userId,
      OR: [{ scheduledStart: { gte: from, lt: to }, status: { in: ["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] } }, { status: { in: ["IN_PROGRESS", "ON_HOLD"] } }],
    },
    orderBy: { scheduledStart: "asc" },
    select: TECHNICIAN_JOB_SELECT,
  });
}

/** One of a technician's jobs, or null when it is not theirs. */
export async function getJobForTechnician(userId: string, jobId: string) {
  return appDb.job.findFirst({ where: { id: jobId, assignedUserId: userId }, select: TECHNICIAN_JOB_SELECT });
}

/** The week's scheduled jobs (any technician) plus everything still to schedule. */
export async function weekSchedule(weekStartDay: string, days = 7) {
  const from = startOfDay(weekStartDay);
  const to = new Date(from.getTime() + days * 86_400_000);
  const [scheduled, unscheduled] = await Promise.all([
    appDb.job.findMany({
      where: { scheduledStart: { gte: from, lt: to }, status: { in: ["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] } },
      orderBy: { scheduledStart: "asc" },
      include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true } } },
    }),
    appDb.job.findMany({
      where: { status: "UNSCHEDULED" },
      orderBy: { createdAt: "asc" },
      include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true } } },
    }),
  ]);
  return { scheduled, unscheduled };
}

export async function countJobsByStatus(): Promise<Record<JobStatusValue, number>> {
  const rows = await appDb.job.groupBy({ by: ["status"], _count: { _all: true } });
  const out = { UNSCHEDULED: 0, SCHEDULED: 0, IN_PROGRESS: 0, ON_HOLD: 0, COMPLETED: 0, INVOICED: 0, PAID: 0 } as Record<JobStatusValue, number>;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}
