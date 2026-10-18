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
import { formatDayTime, startOfDay } from "../../lib/tz";
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
    include: { client: true, site: true, quote: { select: { id: true, number: true, totalCents: true } }, invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, number: true, status: true } }, notes: { orderBy: { createdAt: "desc" } } },
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

/** How long a customer's picked time is held while the office decides. */
export const HOLD_DAYS = 3;
const holdCutoff = (now = new Date()) => new Date(now.getTime() - HOLD_DAYS * 86_400_000);

/** The customer's held time on a job, or null when there is none (or it has lapsed). */
export function activeHold(job: { status: string; requestedUserId: string | null; requestedStart: Date | null; requestedEnd: Date | null; requestedAt: Date | null }, now = new Date()) {
  if (job.status !== "UNSCHEDULED" || !job.requestedUserId || !job.requestedStart || !job.requestedEnd || !job.requestedAt) return null;
  if (job.requestedAt.getTime() < holdCutoff(now).getTime()) return null;
  return { userId: job.requestedUserId, start: job.requestedStart, end: job.requestedEnd, at: job.requestedAt };
}

/** When each technician is committed to a job - or holding a customer's picked time - between two instants (for availability). */
export async function listBusyWindows(from: Date, to: Date) {
  const [booked, held] = await Promise.all([
    appDb.job.findMany({
      where: { assignedUserId: { not: null }, scheduledStart: { lt: to }, scheduledEnd: { gt: from }, status: { in: ["SCHEDULED", "IN_PROGRESS", "ON_HOLD"] } },
      select: { assignedUserId: true, scheduledStart: true, scheduledEnd: true },
    }),
    appDb.job.findMany({
      where: { status: "UNSCHEDULED", requestedUserId: { not: null }, requestedStart: { lt: to }, requestedEnd: { gt: from }, requestedAt: { gte: holdCutoff() } },
      select: { requestedUserId: true, requestedStart: true, requestedEnd: true },
    }),
  ]);
  return [
    ...booked.flatMap((r) => (r.assignedUserId && r.scheduledStart && r.scheduledEnd ? [{ userId: r.assignedUserId, start: r.scheduledStart, end: r.scheduledEnd }] : [])),
    ...held.flatMap((r) => (r.requestedUserId && r.requestedStart && r.requestedEnd ? [{ userId: r.requestedUserId, start: r.requestedStart, end: r.requestedEnd }] : [])),
  ];
}

export class JobHoldError extends Error {}

export async function getJobByQuote(quoteId: string) {
  return appDb.job.findUnique({ where: { quoteId }, include: { client: true, site: true, quote: { select: { id: true, number: true, totalCents: true } } } });
}

/** Holds the time a customer picked for their job: it blocks that technician's calendar until the office approves it. Picking again moves the hold.
 * `fresh` is true when the job had no hold before (the first pick is what asks the office to decide). */
export async function holdJobSlot(jobId: string, input: { userId: string; start: Date; end: Date }, actor: Actor, techLabel: string) {
  if (!(input.end.getTime() > input.start.getTime())) throw new JobHoldError("The end must be after the start.");
  const current = await appDb.job.findUniqueOrThrow({ where: { id: jobId } });
  if (current.status !== "UNSCHEDULED") throw new JobHoldError("This job already has a time. Contact us if you need to change it.");
  const fresh = !activeHold(current);
  const clashes = [...(await findConflicts(input.userId, input.start, input.end, jobId))].map((j) => j.number);
  const otherHolds = await appDb.job.findMany({
    where: { id: { not: jobId }, status: "UNSCHEDULED", requestedUserId: input.userId, requestedStart: { lt: input.end }, requestedEnd: { gt: input.start }, requestedAt: { gte: holdCutoff() } },
    select: { number: true },
  });
  if (clashes.length + otherHolds.length > 0) throw new JobHoldError("Sorry, that time has just been taken. Please choose another.");
  const job = await appDb.$transaction(async (tx) => {
    const saved = await tx.job.update({ where: { id: jobId }, data: { requestedUserId: input.userId, requestedStart: input.start, requestedEnd: input.end, requestedAt: new Date() } });
    await recordActivity(tx, { actor, entityType: "job", entityId: jobId, clientId: saved.clientId, kind: "UPDATED", summary: `${saved.number}: customer asked for ${formatDayTime(input.start)} with ${techLabel}, held for the office to approve` });
    return saved;
  });
  return { job, fresh };
}

/** Lets go of a held time (the office declined it, or it is no longer wanted). */
export async function releaseJobHold(jobId: string, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (!current.requestedStart) return current;
    const job = await tx.job.update({ where: { id: jobId }, data: { requestedUserId: null, requestedStart: null, requestedEnd: null, requestedAt: null } });
    await recordActivity(tx, { actor, entityType: "job", entityId: jobId, clientId: job.clientId, kind: "UPDATED", summary: `${job.number}: the time the customer asked for was released` });
    return job;
  });
}

/** Approves the held time: the job is scheduled for that technician and time, and the hold is cleared. */
export async function confirmJobHold(jobId: string, actor: Actor, techLabel: string) {
  const current = await appDb.job.findUniqueOrThrow({ where: { id: jobId } });
  const hold = activeHold(current);
  if (!hold) throw new JobHoldError(current.status === "UNSCHEDULED" ? "There is no held time any more (it may have lapsed or been changed)." : "This job already has a time.");
  return scheduleJob(jobId, { assignedUserId: hold.userId, start: hold.start, end: hold.end }, actor, techLabel);
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
      data: { assignedUserId: v.assignedUserId, scheduledStart: v.start, scheduledEnd: v.end, status: "SCHEDULED", requestedUserId: null, requestedStart: null, requestedEnd: null, requestedAt: null },
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
  const [scheduled, unscheduled, held] = await Promise.all([
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
    appDb.job.findMany({
      where: { status: "UNSCHEDULED", requestedUserId: { not: null }, requestedStart: { gte: from, lt: to }, requestedAt: { gte: holdCutoff() } },
      orderBy: { requestedStart: "asc" },
      include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true } } },
    }),
  ]);
  return { scheduled, unscheduled, held };
}

export async function countJobsByStatus(): Promise<Record<JobStatusValue, number>> {
  const rows = await appDb.job.groupBy({ by: ["status"], _count: { _all: true } });
  const out = { UNSCHEDULED: 0, SCHEDULED: 0, IN_PROGRESS: 0, ON_HOLD: 0, COMPLETED: 0, INVOICED: 0, PAID: 0 } as Record<JobStatusValue, number>;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

/**
 * The invoicing module moves a job along its billing steps (Completed -> Invoiced
 * -> Paid, or back to Completed when an invoice is voided) inside its own
 * transaction, so the invoice and the job can never disagree.
 */
export async function setBillingStatus(tx: Db, jobId: string, to: "COMPLETED" | "INVOICED" | "PAID", actor: Actor) {
  const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
  const allowed: Record<string, string[]> = { COMPLETED: ["INVOICED"], INVOICED: ["PAID", "COMPLETED"] };
  if (current.status === to) return current;
  if (!allowed[current.status]?.includes(to)) {
    throw new Error(`A job that is ${JOB_STATUS_LABEL[current.status]} cannot move to ${JOB_STATUS_LABEL[to]}.`);
  }
  const job = await tx.job.update({ where: { id: jobId }, data: { status: to } });
  await recordActivity(tx, {
    actor,
    entityType: "job",
    entityId: jobId,
    clientId: job.clientId,
    kind: "STATUS_CHANGED",
    summary: `${job.number}: ${JOB_STATUS_LABEL[current.status]} -> ${JOB_STATUS_LABEL[to]}`,
  });
  return job;
}

/** Completed jobs that have no invoice yet - the "ready to invoice" queue. */
export async function listJobsReadyToInvoice() {
  return appDb.job.findMany({
    where: { status: "COMPLETED", invoices: { none: { status: { not: "VOID" } } } },
    orderBy: { completedAt: "asc" },
    include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true } } },
  });
}
