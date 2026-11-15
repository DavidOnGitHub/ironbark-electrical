"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { acceptItChange, answerItQuestions, approveItSpec, cancelItRequest, getFixSummary, getItConversation, getItFeed, getItRequest, ItActionError, IT_STATUS_LABEL, listItRequests, submitItRequest, syncItRequest, requestItSpecChanges, waitingOnPerson, protectedAreas, mayChangeDependencies, securityAutoMergeOn, type FeedTone, type FixSummary, type ItConversation, type ItStatusValue, type Responder } from "../domain/it";
import { errorMessage } from "./shared";

/** What the assistant panel shows for one request. */
export interface ItRequestView {
  id: string;
  number: string;
  title: string;
  kind: "FEATURE" | "ERROR" | "FINDING";
  status: ItStatusValue;
  statusLabel: string;
  /** What the person has to do next, when it is on them. */
  waiting: string | null;
  /** Touches files only a developer may approve: the business cannot accept it here. */
  needsDeveloper: boolean;
  /** For a prepared fix to a workflow: the workflow to open to review it. Null for everything else. */
  workflowId: string | null;
  /** The areas a developer must review, named for people. Never file paths. */
  protectedAreas: string[];
  previewUrl: string | null;
  requestedBy: string;
  createdAt: string;
  failed: boolean;
}

const view = (r: Awaited<ReturnType<typeof listItRequests>>[number]): ItRequestView => ({
  id: r.id,
  number: r.number,
  title: r.title,
  kind: r.kind,
  status: r.status,
  statusLabel: IT_STATUS_LABEL[r.status],
  waiting: r.needsDeveloper && r.status === "PR_OPEN" ? "A developer must review this change" : r.status === "PR_OPEN" && mayChangeDependencies(r) && securityAutoMergeOn() ? null : waitingOnPerson(r.status),
  needsDeveloper: r.needsDeveloper,
  workflowId: r.workflowProposalId ? r.workflowId : null,
  protectedAreas: protectedAreas(r.protectedFiles),
  previewUrl: r.previewUrl,
  requestedBy: r.requestedByLabel,
  createdAt: r.createdAt.toISOString(),
  failed: r.status === "FAILED" || r.status === "BUILD_FAILED" || r.status === "DEPLOY_FAILED",
});

/** Owner and Office see every request; everyone else sees their own. */
export async function listItRequestsAction(limit = 50): Promise<ItRequestView[]> {
  const user = await requireRole(Access.IT_ASK);
  const all = await listItRequests({ limit: Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 200) });
  const manage = Access.IT_MANAGE.some((role) => user.roles.includes(role));
  return all.filter((r) => manage || r.requestedByUserId === user.id).map(view);
}

export async function submitItRequestAction(input: { title: string; description: string; page?: string }): Promise<{ error: string | null; request?: ItRequestView }> {
  const user = await requireRole(Access.IT_ASK);
  try {
    const { request } = await submitItRequest(
      {
        kind: "FEATURE",
        title: input.title,
        description: input.description,
        context: input.page ? { page: input.page.slice(0, 200), roles: user.roles } : { roles: user.roles },
      },
      { actor: userActor(user), email: user.email },
    );
    return { error: null, request: view(request) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** Refreshes one request from AI Builder, for the panel's refresh button. Own requests only, unless Owner or Office. */
export async function refreshItRequestAction(id: string): Promise<ItRequestView | null> {
  const user = await requireRole(Access.IT_ASK);
  const row = await getItRequest(id);
  const manage = Access.IT_MANAGE.some((role) => user.roles.includes(role));
  if (!row || (!manage && row.requestedByUserId !== user.id)) return null;
  const updated = await syncItRequest(id);
  return updated ? view(updated) : null;
}

// ---- Working a request: questions, plan, acceptance ----

type AuthedUser = Awaited<ReturnType<typeof requireRole>>;

const responder = (user: AuthedUser): Responder => ({ actor: userActor(user), userId: user.id, email: user.email ?? null, name: user.name ?? null, roles: user.roles });
const mayManage = (user: AuthedUser) => Access.IT_MANAGE.some((role) => user.roles.includes(role));

export interface ItDetailView {
  request: ItRequestView;
  conversation: ItConversation | null;
  /** The assistant could not be reached; the request is still shown from what we last saw. */
  error: string | null;
  /** This person may approve the plan and accept the change. */
  canApprove: boolean;
  lastError: string | null;
  /** The merged change did not deploy: why, and the request the assistant opened to fix it. No link to the host: users do not get one. */
  deploy: { error: string; fix: { id: string; number: string; statusLabel: string } | null } | null;
  /** For an error: what happened, from detected to fixed. Null for other requests, or when it could not be built. */
  feed: ItFeedLine[] | null;
  /** For an error: what went wrong, what happens now, and proof, in plain language. */
  summary: FixSummary | null;
}

/** One line of an error's activity feed, ready to show. */
export interface ItFeedLine {
  at: string | null;
  tone: FeedTone;
  text: string;
  detail: string | null;
  url: string | null;
  request: string | null;
}

/** One request with what is waiting on a person. Own requests only, unless Owner or Office. */
export async function getItDetailAction(id: string): Promise<ItDetailView | null> {
  const user = await requireRole(Access.IT_ASK);
  const row = await getItRequest(id);
  if (!row || (!mayManage(user) && row.requestedByUserId !== user.id)) return null;
  const synced = (await syncItRequest(id)) ?? row;
  const { conversation, error } = await getItConversation(id);
  const fixRow = synced.deployFixId ? await getItRequest(synced.deployFixId) : null;
  const deploy = synced.status === "DEPLOY_FAILED" && synced.deployError
    ? { error: synced.deployError, fix: fixRow ? { id: fixRow.id, number: fixRow.number, statusLabel: IT_STATUS_LABEL[fixRow.status] } : null }
    : null;
  let feed: ItFeedLine[] | null = null;
  let summary: FixSummary | null = null;
  if (synced.kind === "ERROR") {
    try {
      feed = (await getItFeed(id)).map((f) => ({ at: f.at ? f.at.toISOString() : null, tone: f.tone, text: f.text, detail: f.detail ?? null, url: f.url ?? null, request: f.request ?? null }));
    } catch (err) {
      console.error("[it] could not build the activity feed", err instanceof Error ? err.message : err);
    }
  }
  if (synced.kind === "ERROR") {
    try {
      summary = await getFixSummary(id);
    } catch (err) {
      console.error("[it] could not build the fix summary", err instanceof Error ? err.message : err);
    }
  }
  return { request: view(synced), conversation, error, canApprove: mayManage(user), lastError: synced.lastError, deploy, feed, summary };
}

/** Runs one of the actions below, handing a refusal back as a message. */
async function act(run: (who: Responder) => Promise<{ id: string }>): Promise<{ error: string | null }> {
  const user = await requireRole(Access.IT_ASK);
  try {
    await run(responder(user));
    return { error: null };
  } catch (err) {
    return { error: err instanceof ItActionError ? err.message : errorMessage(err) };
  }
}

export async function answerItQuestionsAction(id: string, answers: { questionId: string; selected: string[]; other?: string }[]) {
  return act((who) => answerItQuestions(id, answers, who));
}
export async function approveItSpecAction(id: string, version: number) {
  return act((who) => approveItSpec(id, version, who));
}
export async function requestItSpecChangesAction(id: string, version: number, feedback: string) {
  return act((who) => requestItSpecChanges(id, version, feedback, who));
}
export async function acceptItChangeAction(id: string, sha: string) {
  return act((who) => acceptItChange(id, sha, who));
}
export async function cancelItRequestAction(id: string) {
  return act((who) => cancelItRequest(id, who));
}
