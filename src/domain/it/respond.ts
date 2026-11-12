/**
 * What a person does with an IT request: answer the assistant's questions, approve or push back on its plan,
 * accept the finished change, or call it off. Each is taken in AI Builder on behalf of that person (so it credits
 * them), after checking here that they may: AI Builder trusts this app for who someone is.
 * Approving and accepting are for Owner and Office; the person who asked may answer, push back and cancel.
 */
import type { ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { AiBuilderError, delegatedRoleFor, type AiBuilderClient, type ItAnswer, type OnBehalfOf } from "./aiBuilder";
import { readConversation, type ItConversation } from "./conversation";
import { defaultClient, syncItRequest } from "./index";
import { inDeployPhase, isTerminal } from "./status";
import { cancelWorkflowFix, type WorkflowFixClient } from "./workflowFix";

/** The person acting. `roles` are the platform roles (ADMIN = Owner, EDITOR = Office). */
export interface Responder {
  actor: Actor;
  userId: string;
  email: string | null;
  name: string | null;
  roles: string[];
}

export class ItActionError extends Error {}

const canApprove = (who: Responder) => delegatedRoleFor(who.roles) === "approver";

function behalf(who: Responder): OnBehalfOf {
  if (!who.email) throw new ItActionError("Your account has no email address, so the assistant cannot record who did this.");
  return { email: who.email, name: who.name ?? undefined, role: delegatedRoleFor(who.roles) };
}

async function load(id: string, who: Responder, rule: "owner" | "approver"): Promise<ItRequest & { sessionId: string }> {
  const row = await appDb.itRequest.findUnique({ where: { id } });
  if (!row) throw new ItActionError("That request was not found.");
  if (rule === "approver" ? !canApprove(who) : !(canApprove(who) || row.requestedByUserId === who.userId)) {
    throw new ItActionError(rule === "approver" ? "Only the Owner or Office can do this." : "Only the person who asked, the Owner or Office can do this.");
  }
  if (!row.sessionId) throw new ItActionError("The assistant has not picked this up yet.");
  if (isTerminal(row.status) || inDeployPhase(row.status)) throw new ItActionError("This request is finished.");
  return row as ItRequest & { sessionId: string };
}

async function afterAction(row: ItRequest, who: Responder, summary: string, client: AiBuilderClient) {
  await appDb.$transaction((tx) => recordActivity(tx, { actor: who.actor, entityType: "itRequest", entityId: row.id, kind: "UPDATED", summary: `${row.number}: ${summary}` }));
  return (await syncItRequest(row.id, client)) ?? row;
}

/** Runs an AI Builder call, turning its refusals into messages a person can read. */
async function viaBuilder(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AiBuilderError) throw new ItActionError(err.status === 409 || err.status === 400 ? `The assistant could not do that now: ${err.message}` : err.message);
    throw err;
  }
}

/** The request with what is waiting on a person. A failure to reach AI Builder is reported, not thrown. */
export async function getItConversation(id: string, client: AiBuilderClient | null = defaultClient()): Promise<{ request: ItRequest; conversation: ItConversation | null; error: string | null }> {
  const request = await appDb.itRequest.findUniqueOrThrow({ where: { id } });
  if (!request.sessionId || !client) return { request, conversation: null, error: null };
  try {
    return { request, conversation: readConversation(await client.getSession(request.sessionId)), error: null };
  } catch (err) {
    return { request, conversation: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function answerItQuestions(id: string, answers: ItAnswer[], who: Responder, client: AiBuilderClient | null = defaultClient()) {
  if (!client) throw new ItActionError("The assistant is not connected.");
  const row = await load(id, who, "owner");
  const clean = answers.map((a) => ({ questionId: a.questionId, selected: a.selected, other: a.other?.trim() || undefined })).filter((a) => a.selected.length > 0 || a.other);
  if (clean.length === 0) throw new ItActionError("Answer at least one question.");
  await viaBuilder(() => client.sendMessage(row.sessionId, { answers: clean }, behalf(who)));
  return afterAction(row, who, "questions answered", client);
}

export async function approveItSpec(id: string, version: number, who: Responder, client: AiBuilderClient | null = defaultClient()) {
  if (!client) throw new ItActionError("The assistant is not connected.");
  const row = await load(id, who, "approver");
  await viaBuilder(() => client.approveSpec(row.sessionId, version, behalf(who)));
  return afterAction(row, who, "plan approved", client);
}

export async function requestItSpecChanges(id: string, version: number, feedback: string, who: Responder, client: AiBuilderClient | null = defaultClient()) {
  if (!client) throw new ItActionError("The assistant is not connected.");
  const text = feedback.trim();
  if (!text) throw new ItActionError("Say what should change.");
  const row = await load(id, who, "owner");
  await viaBuilder(() => client.requestChanges(row.sessionId, version, text, behalf(who)));
  return afterAction(row, who, "changes asked for on the plan", client);
}

export async function acceptItChange(id: string, sha: string, who: Responder, client: AiBuilderClient | null = defaultClient()) {
  if (!client) throw new ItActionError("The assistant is not connected.");
  const row = await load(id, who, "approver");
  if (row.needsDeveloper) throw new ItActionError(`This change touches files only a developer may approve (${row.protectedFiles.slice(0, 3).join(", ")}). Ask a developer to review and accept it.`);
  await viaBuilder(() => client.accept(row.sessionId, sha, behalf(who)));
  return afterAction(row, who, "change accepted", client);
}

export async function cancelItRequest(id: string, who: Responder, client: AiBuilderClient | null = defaultClient(), fixClient?: WorkflowFixClient | null) {
  // A prepared workflow fix has no AI Builder session: calling it off drops the proposal in the editor.
  const prepared = await appDb.itRequest.findUnique({ where: { id } });
  if (prepared?.workflowProposalId) {
    if (!(canApprove(who) || prepared.requestedByUserId === who.userId)) throw new ItActionError("Only the person who asked, the Owner or Office can do this.");
    if (prepared.status !== "PROPOSED") throw new ItActionError("This request is finished.");
    return cancelWorkflowFix(id, who.actor, fixClient);
  }
  if (!client) throw new ItActionError("The assistant is not connected.");
  const row = await load(id, who, "owner");
  await viaBuilder(() => client.cancel(row.sessionId, behalf(who)));
  return afterAction(row, who, "cancelled", client);
}
