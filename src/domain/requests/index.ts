/** Requests (enquiries) module - the public API. */
import { z } from "zod";
import { appDb, type Prisma } from "../../db/app";
import type { RequestStatus } from "ironbark-electrical-client";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { createClient, findPossibleDuplicates, type DuplicateMatch } from "../clients";
import { canTransition, isOpenStatus, REQUEST_STATUS_LABEL, REQUEST_STATUS_ORDER } from "./status";

export * from "./status";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const RequestInputSchema = z.object({
  source: z.enum(["EMAIL", "PHONE", "MANUAL", "WEB"]).default("MANUAL"),
  category: z.enum(["NEW_INSTALL", "FAULT_REPAIR", "QUOTE_REQUEST", "OTHER"]).default("OTHER"),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE"),
  summary: z.string().trim().min(1, "A short summary is required").max(200),
  description: z.preprocess(blank, z.string().trim().max(4000).optional()),
  clientId: z.preprocess(blank, z.string().optional()),
  siteId: z.preprocess(blank, z.string().optional()),
  contactName: z.preprocess(blank, z.string().trim().max(200).optional()),
  contactEmail: z.preprocess(blank, z.string().trim().email("Enter a valid email").max(200).optional()),
  contactPhone: z.preprocess(blank, z.string().trim().max(40).optional()),
  ownerUserId: z.preprocess(blank, z.string().optional()),
  receivedAt: z.date().optional(),
  rawEmailRef: z.preprocess(blank, z.string().max(200).optional()),
});
export type RequestInput = z.input<typeof RequestInputSchema>;

export async function createRequest(input: RequestInput, actor: Actor) {
  const data = RequestInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: {
        source: data.source,
        category: data.category,
        urgency: data.urgency,
        summary: data.summary,
        description: data.description ?? null,
        clientId: data.clientId ?? null,
        siteId: data.siteId ?? null,
        contactName: data.contactName ?? null,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        ownerUserId: data.ownerUserId ?? null,
        rawEmailRef: data.rawEmailRef ?? null,
        ...(data.receivedAt ? { receivedAt: data.receivedAt, statusChangedAt: data.receivedAt } : {}),
      },
    });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: request.id,
      clientId: request.clientId,
      kind: "CREATED",
      summary: `Request received: ${request.summary}`,
    });
    return request;
  });
}

export interface RequestListFilter {
  status?: RequestStatus;
  ownerUserId?: string;
  openOnly?: boolean;
  limit?: number;
}

export async function listRequests(filter: RequestListFilter = {}) {
  const where: Prisma.RequestWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
    ...(filter.openOnly ? { status: { notIn: ["WON", "LOST"] } } : {}),
  };
  return appDb.request.findMany({
    where,
    orderBy: [{ urgency: "desc" }, { receivedAt: "asc" }],
    take: filter.limit ?? 200,
    include: { client: { select: { id: true, name: true } }, site: { select: { suburb: true } } },
  });
}

export async function getRequest(id: string) {
  return appDb.request.findUnique({ where: { id }, include: { client: true, site: true } });
}

export async function countByStatus(): Promise<Record<RequestStatus, number>> {
  const rows = await appDb.request.groupBy({ by: ["status"], _count: { _all: true } });
  const out = Object.fromEntries(REQUEST_STATUS_ORDER.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

export class InvalidTransitionError extends Error {}

export async function changeStatus(id: string, to: RequestStatus, opts: { lostReason?: string }, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const current = await tx.request.findUniqueOrThrow({ where: { id } });
    if (!canTransition(current.status, to)) {
      throw new InvalidTransitionError(`A request that is ${REQUEST_STATUS_LABEL[current.status]} cannot move to ${REQUEST_STATUS_LABEL[to]}.`);
    }
    const lostReason = to === "LOST" ? (opts.lostReason?.trim() || null) : null;
    const request = await tx.request.update({
      where: { id },
      data: { status: to, statusChangedAt: new Date(), lostReason },
    });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: id,
      clientId: request.clientId,
      kind: "STATUS_CHANGED",
      summary: `${request.summary}: ${REQUEST_STATUS_LABEL[current.status]} -> ${REQUEST_STATUS_LABEL[to]}`,
      body: lostReason,
    });
    return request;
  });
}

export async function assignOwner(id: string, ownerUserId: string | null, ownerLabel: string | null, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const request = await tx.request.update({ where: { id }, data: { ownerUserId } });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: id,
      clientId: request.clientId,
      kind: "UPDATED",
      summary: ownerUserId ? `${request.summary}: assigned to ${ownerLabel ?? "a team member"}` : `${request.summary}: unassigned`,
    });
    return request;
  });
}

export async function linkClient(id: string, clientId: string, siteId: string | null, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const request = await tx.request.update({ where: { id }, data: { clientId, siteId } });
    await recordActivity(tx, {
      actor,
      entityType: "request",
      entityId: id,
      clientId,
      kind: "LINKED",
      summary: `Request linked to this client: ${request.summary}`,
    });
    return request;
  });
}

/** Creates a client from the enquirer's contact details and links the request to it. */
export async function createClientFromRequest(id: string, actor: Actor) {
  const request = await appDb.request.findUniqueOrThrow({ where: { id } });
  if (request.clientId) throw new Error("This request is already linked to a client.");
  const client = await createClient(
    {
      type: "PERSON",
      name: request.contactName?.trim() || request.contactEmail || "New client",
      email: request.contactEmail ?? undefined,
      phone: request.contactPhone ?? undefined,
      preferredContact: request.contactEmail ? "EMAIL" : "PHONE",
      tags: [],
    },
    actor,
  );
  await linkClient(id, client.id, null, actor);
  return client;
}

/** Existing clients that look like the enquirer of an unlinked request. */
export async function duplicateHintsForRequest(request: { clientId: string | null; contactEmail: string | null; contactPhone: string | null }): Promise<DuplicateMatch[]> {
  if (request.clientId) return [];
  return findPossibleDuplicates({ email: request.contactEmail, phone: request.contactPhone });
}

export { isOpenStatus };
