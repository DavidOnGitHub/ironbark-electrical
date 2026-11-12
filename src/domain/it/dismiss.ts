/**
 * A person decides a finding is not worth fixing: they accept the risk, or say the scanner was wrong. The finding then
 * leaves the open count and the dashboard banner, is never sent to the assistant, and stays as decided when a later scan
 * reports it again (see ingestScan). If a fix for it is already under way that fix is called off, which also frees the
 * security lane for the next one. Owner and Office only. Reopening undoes it and puts the finding back in the queue.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import { delegatedRoleFor, type AiBuilderClient } from "./aiBuilder";
import { IN_FLIGHT } from "./lane";
import { defaultClient } from "./index";
import { cancelItRequest, ItActionError, type Responder } from "./respond";

export const DISMISSALS = ["ACCEPTED_RISK", "FALSE_POSITIVE"] as const;
export type Dismissal = (typeof DISMISSALS)[number];
export const DISMISSAL_LABEL: Record<Dismissal, string> = { ACCEPTED_RISK: "Risk accepted", FALSE_POSITIVE: "False positive" };

const mayDecide = (who: Responder) => delegatedRoleFor(who.roles) === "approver";

export async function dismissFinding(input: { id: string; status: string; reason?: string | null }, who: Responder, client: AiBuilderClient | null = defaultClient()): Promise<void> {
  if (!mayDecide(who)) throw new ItActionError("Only the Owner or Office can do this.");
  if (!(DISMISSALS as readonly string[]).includes(input.status)) throw new ItActionError("Choose accept the risk, or false positive.");
  const status = input.status as Dismissal;
  const reason = (input.reason ?? "").trim().slice(0, 500);
  if (status === "ACCEPTED_RISK" && reason.length < 3) throw new ItActionError("Say briefly why the risk is acceptable.");

  const finding = await appDb.finding.findUnique({ where: { id: input.id } });
  if (!finding) throw new ItActionError("That finding was not found.");
  if (finding.status !== "OPEN" && finding.status !== "FIXING") throw new ItActionError("That finding is already closed.");

  // Call off a fix that is still under way first: if that cannot be done, nothing else changes.
  if (finding.itRequestId) {
    const request = await appDb.itRequest.findUnique({ where: { id: finding.itRequestId } });
    if (request && IN_FLIGHT.includes(request.status)) {
      if (request.sessionId) {
        if (!client) throw new ItActionError("The assistant is not connected, so its fix could not be called off.");
        await cancelItRequest(request.id, who, client);
      } else {
        await appDb.$transaction(async (tx) => {
          await tx.itRequest.update({ where: { id: request.id }, data: { status: "CLOSED" } });
          await recordActivity(tx, { actor: who.actor, entityType: "itRequest", entityId: request.id, kind: "STATUS_CHANGED", summary: `${request.number}: called off because the finding was dismissed` });
        });
      }
    }
  }

  await appDb.$transaction(async (tx) => {
    await tx.finding.update({ where: { id: finding.id }, data: { status, fixedAt: null } });
    await recordActivity(tx, { actor: who.actor, entityType: "finding", entityId: finding.id, kind: "DISMISSED", summary: `${DISMISSAL_LABEL[status]}: ${finding.message.slice(0, 100)}`, body: reason || null });
  });
}

/** Undoes a dismissal. The finding is open again and, if it is serious enough, goes back in line for a fix. */
export async function reopenFinding(id: string, who: Responder): Promise<void> {
  if (!mayDecide(who)) throw new ItActionError("Only the Owner or Office can do this.");
  const finding = await appDb.finding.findUnique({ where: { id } });
  if (!finding) throw new ItActionError("That finding was not found.");
  if (finding.status !== "ACCEPTED_RISK" && finding.status !== "FALSE_POSITIVE") throw new ItActionError("That finding is not dismissed.");
  await appDb.$transaction(async (tx) => {
    await tx.finding.update({ where: { id }, data: { status: "OPEN", itRequestId: null } });
    await recordActivity(tx, { actor: who.actor, entityType: "finding", entityId: id, kind: "REOPENED", summary: `Reopened: ${finding.message.slice(0, 100)}` });
  });
}

export interface DismissedFinding {
  id: string;
  status: Dismissal;
  severity: string;
  tool: string;
  message: string;
  file: string | null;
  reason: string | null;
  by: string | null;
  at: Date;
}

/** The most recent dismissals with the reason each was given. */
export async function listDismissedFindings(limit = 10): Promise<DismissedFinding[]> {
  const rows = await appDb.finding.findMany({ where: { status: { in: [...DISMISSALS] } }, orderBy: { updatedAt: "desc" }, take: limit });
  if (rows.length === 0) return [];
  const events = await appDb.activityEvent.findMany({ where: { entityType: "finding", entityId: { in: rows.map((r) => r.id) }, kind: "DISMISSED" }, orderBy: { at: "desc" } });
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!latest.has(e.entityId)) latest.set(e.entityId, e);
  return rows.map((r) => ({ id: r.id, status: r.status as Dismissal, severity: r.severity, tool: r.tool, message: r.message, file: r.file, reason: latest.get(r.id)?.body ?? null, by: latest.get(r.id)?.actorLabel ?? null, at: latest.get(r.id)?.at ?? r.updatedAt }));
}
