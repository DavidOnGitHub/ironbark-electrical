/**
 * The IT audit log: every recorded action of the IT assistant and the people who direct it, newest first. It is read from the
 * activity trail that each change already writes in the same transaction, so what is shown cannot disagree with what happened.
 * Each line says who (a named person, the assistant, or the system), when, and what; a request's lines also say which request.
 */
import { appDb } from "../../db/app";

export const AUDIT_ENTITIES = ["itRequest", "finding", "errorEvent", "release", "appFlag"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
export const AUDIT_FILTERS = ["all", "requests", "findings", "errors", "releases", "switches"] as const;
export type AuditFilter = (typeof AUDIT_FILTERS)[number];
export const AUDIT_FILTER_LABEL: Record<AuditFilter, string> = { all: "Everything", requests: "Requests", findings: "Security findings", errors: "Errors", releases: "Releases", switches: "Demo switches" };
const ENTITIES_OF: Record<AuditFilter, readonly AuditEntity[]> = { all: AUDIT_ENTITIES, requests: ["itRequest"], findings: ["finding"], errors: ["errorEvent"], releases: ["release"], switches: ["appFlag"] };
export const AUDIT_ACTORS = ["any", "people", "assistant"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];
export const AUDIT_PAGE = 50;

export interface AuditLine {
  id: string;
  at: Date;
  /** A person, the assistant, or a workflow. */
  actorType: "USER" | "SYSTEM" | "WORKFLOW";
  actor: string;
  entity: AuditEntity;
  summary: string;
  /** Longer text some entries carry, such as why a finding was dismissed. */
  detail: string | null;
  /** The request an entry belongs to, when it is about one. */
  request: { id: string; number: string; kind: "FEATURE" | "ERROR" | "FINDING"; title: string } | null;
}

export interface AuditPage {
  lines: AuditLine[];
  /** Pass back as `before` for the next, older page; null at the end. */
  next: string | null;
}

export const isAuditFilter = (v: unknown): v is AuditFilter => (AUDIT_FILTERS as readonly unknown[]).includes(v);
export const isAuditActor = (v: unknown): v is AuditActor => (AUDIT_ACTORS as readonly unknown[]).includes(v);

/** `before` is the `next` of the page before it (an ISO time and an id), so paging stays correct while new entries arrive. */
export async function listAudit(opts: { filter?: AuditFilter; actor?: AuditActor; before?: string | null } = {}): Promise<AuditPage> {
  const filter = opts.filter ?? "all";
  const actor = opts.actor ?? "any";
  const cursor = parseCursor(opts.before);
  const rows = await appDb.activityEvent.findMany({
    where: {
      entityType: { in: [...ENTITIES_OF[filter]] },
      ...(actor === "people" ? { actorType: "USER" as const } : actor === "assistant" ? { actorType: { not: "USER" as const } } : {}),
      ...(cursor ? { OR: [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE + 1,
  });
  const page = rows.slice(0, AUDIT_PAGE);
  const requests = await appDb.itRequest.findMany({
    where: { id: { in: page.filter((r) => r.entityType === "itRequest").map((r) => r.entityId) } },
    select: { id: true, number: true, kind: true, title: true },
  });
  const byId = new Map(requests.map((r) => [r.id, r]));
  const lines: AuditLine[] = page.map((r) => ({
    id: r.id,
    at: r.at,
    actorType: r.actorType as AuditLine["actorType"],
    actor: r.actorLabel ?? (r.actorType === "USER" ? "A person" : "The system"),
    entity: r.entityType as AuditEntity,
    summary: r.summary,
    detail: r.body,
    request: r.entityType === "itRequest" ? (byId.get(r.entityId) ?? null) : null,
  }));
  const last = page[page.length - 1];
  return { lines, next: rows.length > AUDIT_PAGE && last ? `${last.at.toISOString()}_${last.id}` : null };
}

function parseCursor(raw: string | null | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const i = raw.indexOf("_");
  if (i < 0) return null;
  const at = new Date(raw.slice(0, i));
  const id = raw.slice(i + 1);
  return Number.isNaN(at.getTime()) || !id ? null : { at, id };
}
