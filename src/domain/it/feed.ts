/**
 * The activity feed for an error: one readable timeline from "detected" to "confirmed fixed", across every attempt
 * to fix it. It is assembled from what we already hold - the captured error, its requests, and each AI Builder
 * session's own events (which carry timestamps) - so nothing extra is recorded. `buildFeed` is pure.
 *
 * Session events cross a service boundary, so they are read defensively, and their free text (commit messages,
 * error text) is clipped: it is shown to people, never acted on.
 */
import type { ErrorEvent, ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { defaultClient } from "./index";
import type { AiEvent, AiSessionDetail, AiBuilderClient } from "./aiBuilder";
import type { ErrorClass } from "./classify";
import { CLASS_PLAIN, protectedAreas, times, whereLabel } from "./plain";
import { IT_STATUS_LABEL } from "./status";

export type FeedTone = "info" | "ok" | "bad" | "wait";
export interface FeedItem {
  /** Null for "where it stands now" lines that have no time of their own. */
  at: Date | null;
  tone: FeedTone;
  text: string;
  detail?: string;
  url?: string;
  /** The request this belongs to (IT-1005), when the error has had more than one attempt. */
  request?: string;
}

export interface FeedAttempt {
  request: Pick<ItRequest, "number" | "status" | "createdAt" | "updatedAt" | "mergedAt" | "deployError" | "prUrl" | "previewUrl"> & Partial<Pick<ItRequest, "needsDeveloper" | "protectedFiles" | "lastError" | "workflowProposalId">>;
  /** The AI Builder session's events; null when it could not be read. */
  events: AiEvent[] | null;
  /** AI Builder's own verdict on whether the change can be accepted yet (checks passed, preview up, nothing blocking). */
  acceptance?: { ready: boolean } | null;
}

export interface FeedInput {
  error: (Pick<ErrorEvent, "firstSeenAt" | "message" | "route" | "count" | "resolvedAt" | "regressions" | "source"> & Partial<Pick<ErrorEvent, "classification" | "classConfidence" | "classReason" | "classifiedAt">>) | null;
  /** When the error returned after being marked fixed. */
  reopenedAt: Date[];
  attempts: FeedAttempt[];
  /** Title of the request when there is no captured error behind it (for example a failed deploy). */
  fallbackTitle?: string;
}

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const MAX_ITEMS = 80;
const when = (v: unknown): Date | null => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const names = (files: unknown): string[] => (Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : []);

function sessionItems(events: AiEvent[], request: string | undefined): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const add = (e: AiEvent, item: Omit<FeedItem, "at" | "request">) => out.push({ at: when(e.at), request, ...item });

  for (const e of events) {
    switch (e.type) {
      case "spec_ready":
        if (once(`spec${e.version}`)) add(e, { tone: "wait", text: "Plan ready for approval" });
        break;
      case "spec_approved":
        add(e, { tone: "ok", text: "Plan approved" });
        break;
      case "build_started":
        add(e, { tone: "info", text: e.iteration && Number(e.iteration) > 1 ? `Fix revised (round ${e.iteration})` : "Fix started", detail: e.trigger === "ci" ? "The automatic checks found a problem, so the assistant is trying again" : undefined });
        break;
      case "command_run": {
        if (!/test/i.test(str(e.name))) break;
        const ok = e.exitCode === 0;
        add(e, { tone: ok ? "ok" : "bad", text: ok ? "Tested automatically: passed" : "Tested automatically: found a problem" });
        break;
      }
      case "commit_pushed": {
        if (e.reason === "base_update") break;
        if (names(e.files).some((f) => TEST_FILE.test(f)) && once("guard")) add(e, { tone: "ok", text: "Checked it can't happen again" });
        if (once("prepared")) add(e, { tone: "info", text: "Fix prepared" });
        break;
      }
      case "pr_opened":
        add(e, { tone: "info", text: "Fix ready for review" });
        break;
      case "ci_status": {
        const state = str(e.state);
        if (state === "pending" || state === "none") break;
        if (once(`ci${e.sha}${state}`)) add(e, { tone: state === "success" ? "ok" : "bad", text: state === "success" ? "Automatic checks passed" : "Automatic checks found a problem" });
        break;
      }
      case "preview_ready":
        if (once(`pv${e.sha}`)) add(e, { tone: "ok", text: "Preview ready - try it", url: str(e.url) || undefined });
        break;
      case "accepted":
        add(e, { tone: "ok", text: "Accepted" });
        break;
      case "pr_closed":
        add(e, e.merged ? { tone: "ok", text: "Put into the app" } : { tone: "bad", text: "The fix was set aside without being used" });
        break;
      case "error":
        add(e, { tone: "bad", text: "The assistant hit a problem" });
        break;
    }
  }
  return out;
}

export function buildFeed(input: FeedInput): FeedItem[] {
  const { error, attempts } = input;
  const items: FeedItem[] = [];
  const multi = attempts.length > 1;

  if (error) {
    items.push({ at: error.firstSeenAt, tone: "bad", text: `${whereLabel(error.route, error.source)} showed an error`, detail: error.count > 1 ? `Happened ${times(error.count)} so far` : undefined });
    if (error.classification && error.classification in CLASS_PLAIN) {
      const kind = error.classification as ErrorClass;
      items.push({
        at: error.classifiedAt ?? error.firstSeenAt,
        tone: "info",
        text: `Looked into it: ${CLASS_PLAIN[kind]}`,
      });
    }
  } else if (input.fallbackTitle) {
    items.push({ at: attempts[0]?.request.createdAt ?? null, tone: "bad", text: "A problem was reported" });
  }
  for (const at of input.reopenedAt) items.push({ at, tone: "bad", text: "The error came back after its fix" });

  for (const [i, a] of attempts.entries()) {
    const label = multi ? a.request.number : undefined;
    const forWorkflow = Boolean(a.request.workflowProposalId);
    const asked = forWorkflow ? "assistant prepared a fix to the workflow" : "assistant asked to fix it";
    items.push({ at: a.request.createdAt, tone: "info", text: multi ? `Attempt ${i + 1}: ${asked}` : `${asked[0]!.toUpperCase()}${asked.slice(1)}`, request: label });
    if (a.events) items.push(...sessionItems(a.events, label));
    if (a.request.mergedAt && !(a.events ?? []).some((e) => e.type === "pr_closed" && e.merged)) items.push({ at: a.request.mergedAt, tone: "ok", text: "Put into the app", request: label });
    if (a.request.needsDeveloper) items.push({ at: a.request.updatedAt, tone: "wait", text: "A developer must review it first", detail: protectedAreas(a.request.protectedFiles ?? []).join(", ") || undefined, request: label });
    if (a.request.lastError?.startsWith("Stopped:")) items.push({ at: a.request.updatedAt, tone: "bad", text: "Stopped: it was costing more than the limit", request: label });
    if (a.request.deployError) items.push({ at: a.request.updatedAt, tone: "bad", text: "The fix did not start up properly", request: label });
  }

  if (error?.resolvedAt) {
    const workflowFix = Boolean(attempts[attempts.length - 1]?.request.workflowProposalId);
    items.push({ at: error.resolvedAt, tone: "ok", text: workflowFix ? "Fix applied - publish the workflow to make it live, then watching for a repeat" : "Fix is live - watching for a repeat" });
  }

  // Where it stands now, on the latest attempt.
  const latest = attempts[attempts.length - 1]?.request;
  if (latest && !error?.resolvedAt) {
    const last = attempts[attempts.length - 1]!;
    const now = latest.needsDeveloper && latest.status === "PR_OPEN" ? "Waiting for a developer to review it" : latest.status === "PR_OPEN" ? prOpenStanding(last) : standing(latest.status);
    if (now) items.push({ at: null, tone: "wait", text: now, request: multi ? latest.number : undefined });
  }

  const dated = items.filter((i) => i.at).sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const undated = items.filter((i) => !i.at);
  return [...dated, ...undated].slice(-MAX_ITEMS);
}

/**
 * A pull request being open does not mean a person can act yet: they can only try and accept the change once the
 * automatic checks have passed and the preview is up. Says which of those it is waiting on.
 */
function prOpenStanding(a: FeedAttempt): string {
  const events = a.events ?? [];
  const pushed = [...events].reverse().find((e) => e.type === "commit_pushed");
  const sha = pushed ? str(pushed.sha) : "";
  const ci = [...events].reverse().find((e) => e.type === "ci_status" && (!sha || e.sha === sha));
  const state = ci ? str(ci.state) : "";
  const hasPreview = Boolean(a.request.previewUrl) || events.some((e) => e.type === "preview_ready" && (!sha || e.sha === sha));

  if (a.acceptance?.ready) return "Waiting for someone to try the change and accept it";
  if (a.events === null && !a.acceptance) return hasPreview ? "Waiting for someone to try the change and accept it" : "Getting the change ready to try";
  if (state === "failure" || state === "error") return "Automatic checks found a problem - the assistant is looking at it";
  if (!ci) return "Getting the change ready to try";
  if (state !== "success") return "Automatic checks are running - the change can be tried once they pass";
  if (!hasPreview) return "Automatic checks passed - waiting for the preview to be ready to try";
  return a.acceptance ? "Getting the change ready to try" : "Waiting for someone to try the change and accept it";
}

/** What it is waiting on right now, in plain words. */
function standing(status: ItRequest["status"]): string | null {
  switch (status) {
    case "SPEC_REVIEW":
      return "Waiting for someone to approve the plan";
    case "PROPOSED":
      return "Waiting for someone to review the prepared fix in the workflow editor";
    case "PR_OPEN":
      return "Getting the change ready to try"; // buildFeed refines this from the checks and the preview (prOpenStanding)
    case "ACCEPTED":
    case "MERGED":
      return "Merging and going live";
    case "SUBMITTED":
    case "DRAFTING_SPEC":
    case "BUILDING":
      return "The assistant is working on it";
    case "BUILD_FAILED":
    case "DEPLOY_FAILED":
    case "FAILED":
      return "Needs a developer to take a look";
    case "CLOSED":
      return `${IT_STATUS_LABEL.CLOSED}`;
    default:
      return null;
  }
}

/** Loads everything for one request's feed. A session that cannot be read leaves that attempt thinner, not the feed empty. */
export async function getItFeed(requestId: string, client: AiBuilderClient | null = defaultClient()): Promise<FeedItem[]> {
  const request = await appDb.itRequest.findUniqueOrThrow({ where: { id: requestId } });
  const errorId = request.sourceType === "error" ? request.sourceId : null;
  const [error, siblings, reopened] = await Promise.all([
    errorId ? appDb.errorEvent.findUnique({ where: { id: errorId } }) : null,
    errorId ? appDb.itRequest.findMany({ where: { sourceType: "error", sourceId: errorId }, orderBy: { createdAt: "asc" } }) : [request],
    errorId ? appDb.activityEvent.findMany({ where: { entityType: "errorEvent", entityId: errorId, kind: "REOPENED" }, orderBy: { at: "asc" }, select: { at: true } }) : [],
  ]);
  const attempts: FeedAttempt[] = await Promise.all(
    // Only the request being looked at: an earlier attempt's steps belong to that request's own page.
    siblings.filter((r) => r.id === request.id).map(async (r) => {
      let events: AiEvent[] | null = null;
      let acceptance: FeedAttempt["acceptance"] = null;
      if (r.sessionId && client) {
        try {
          const detail = (await client.getSession(r.sessionId)) as AiSessionDetail;
          events = detail.events;
          acceptance = detail.acceptance ? { ready: detail.acceptance.ready } : null;
        } catch {
          events = null;
        }
      }
      return { request: r, events, acceptance };
    }),
  );
  // The return that led to this attempt: after the previous attempt began and no later than this one's start.
  const previous = siblings.filter((r) => r.createdAt < request.createdAt).at(-1);
  const reopenedAt = reopened.map((x) => x.at).filter((at) => at <= request.createdAt && (!previous || at > previous.createdAt));
  // "Fixed" belongs to the attempt that went live. The error's own flag only says whether it is fixed right now.
  const resolvedAt = error ? (request.status === "LIVE" ? (request.liveAt ?? error.resolvedAt) : error.resolvedAt && error.resolvedAt >= request.createdAt ? error.resolvedAt : null) : null;
  return buildFeed({ error: error ? { ...error, resolvedAt } : error, reopenedAt, attempts, fallbackTitle: request.title });
}
