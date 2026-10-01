import type { Prisma, PrismaClient } from "../../db/app";
import { appDb } from "../../db/app";
import type { Actor } from "../shared/actor";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ActivityInput {
  actor: Actor;
  entityType: "client" | "site" | "request" | "pricing" | "quote" | "job";
  entityId: string;
  kind: string;
  summary: string;
  body?: string | null;
  clientId?: string | null;
}

/** Writes one timeline entry. Modules call this from the same transaction as the
 * change itself, so an action and its history can never disagree. */
export async function recordActivity(db: Db, input: ActivityInput) {
  const { actor } = input;
  return db.activityEvent.create({
    data: {
      actorType: actor.type,
      actorUserId: actor.type === "USER" ? actor.userId : null,
      actorLabel: actor.label,
      workflowInstanceId: actor.type === "WORKFLOW" ? (actor.workflowInstanceId ?? null) : null,
      clientId: input.clientId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      kind: input.kind,
      summary: input.summary,
      body: input.body ?? null,
    },
  });
}

export async function listClientTimeline(clientId: string, limit = 100) {
  return appDb.activityEvent.findMany({ where: { clientId }, orderBy: { at: "desc" }, take: limit });
}

export async function listRecentActivity(limit = 8) {
  return appDb.activityEvent.findMany({ orderBy: { at: "desc" }, take: limit, include: { client: { select: { id: true, name: true } } } });
}

export async function listEntityTimeline(entityType: string, entityId: string, limit = 50) {
  return appDb.activityEvent.findMany({ where: { entityType, entityId }, orderBy: { at: "desc" }, take: limit });
}
