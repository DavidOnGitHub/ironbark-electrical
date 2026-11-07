/**
 * The before/after panel for an error's fix, in plain language for non-technical people: what went wrong for them,
 * what happens now, and proof it is fixed. It never contains code, file names, test names or links to the code.
 *
 * Wording comes from what we already hold. The assistant's own plan summary or closing message is used only if it
 * reads as plain language (`looksPlain`); otherwise a generic sentence is shown instead.
 */
import type { ErrorEvent, ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import type { AiBuilderClient, AiEvent } from "./aiBuilder";
import { BUCKET_MS } from "./errors";
import { defaultClient } from "./index";
import { firstSentences, looksPlain, times, whereLabel } from "./plain";

export type CheckState = "ok" | "bad" | "wait";
export interface FixCheck {
  label: string;
  state: CheckState;
}

export interface FixSummary {
  /** What went wrong for people. */
  before: string;
  /** What happens now; null until there is something honest to say. */
  after: string | null;
  checks: FixCheck[];
  /** How often it happened before the fix and since. */
  counts: string | null;
  previewUrl: string | null;
}

export interface FixSummaryInput {
  error: Pick<ErrorEvent, "route" | "source" | "count" | "resolvedAt"> | null;
  request: Pick<ItRequest, "status" | "liveAt" | "previewUrl" | "title">;
  events: AiEvent[] | null;
  /** Occurrences since the fix went live (null when it is not live). */
  since: number | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const last = (events: AiEvent[], type: string) => [...events].reverse().find((e) => e.type === type);

/** The assistant's own words about the fix, if they are plain enough to show. */
function assistantWords(events: AiEvent[]): string | null {
  const spec = last(events, "spec_ready") as { spec?: { summary?: unknown } } | undefined;
  const candidates = [str(spec?.spec?.summary), str((last(events, "assistant_message") as { text?: unknown } | undefined)?.text)];
  for (const c of candidates) if (looksPlain(c)) return firstSentences(c);
  return null;
}

function checksFrom(events: AiEvent[]): FixCheck[] {
  const out: FixCheck[] = [];
  const test = last(events.filter((e) => e.type === "command_run" && /test/i.test(str(e.name))), "command_run");
  if (test) out.push({ label: test.exitCode === 0 ? "Tested automatically" : "Automatic tests found a problem", state: test.exitCode === 0 ? "ok" : "bad" });
  const ci = last(events.filter((e) => e.type === "ci_status" && e.state !== "pending" && e.state !== "none"), "ci_status");
  if (ci) out.push({ label: ci.state === "success" ? "Automatic checks passed" : "Automatic checks found a problem", state: ci.state === "success" ? "ok" : "bad" });
  if (last(events, "preview_ready")) out.push({ label: "Preview ready to try", state: "ok" });
  return out;
}

export function buildFixSummary(input: FixSummaryInput): FixSummary {
  const { error, request, events } = input;
  const live = request.status === "LIVE" || request.liveAt !== null;

  const before = error ? `${whereLabel(error.route, error.source)} showed an error.` : "Something in the app was not working.";
  const words = events ? assistantWords(events) : null;
  let after: string | null = words;
  if (!after) {
    if (live) after = "The problem has been fixed.";
    else if (request.status === "PR_OPEN") after = "A fix is ready for you to try.";
    else if (request.status === "PROPOSED") after = "A change to the workflow is ready for someone to review.";
    else if (request.status === "APPLIED") after = "The change was applied to the workflow. Publish the workflow to make it live.";
    else if (request.status === "ACCEPTED" || request.status === "MERGED") after = "The fix is going live.";
  } else if (!live && request.status !== "PR_OPEN" && request.status !== "ACCEPTED" && request.status !== "MERGED") {
    // A plan that is only proposed is not yet what happens now.
    after = `Planned: ${after}`;
  }

  let counts: string | null = null;
  if (error) {
    if (live && input.since !== null) {
      const earlier = Math.max(error.count - input.since, 0);
      counts = input.since === 0 ? `Happened ${times(earlier)} before the fix. Not once since it went live.` : `Happened ${times(earlier)} before the fix, and ${times(input.since)} since it went live.`;
    } else if (error.count > 0) {
      counts = `Happened ${times(error.count)} so far.`;
    }
  }

  return { before, after, checks: events ? checksFrom(events) : [], counts, previewUrl: request.previewUrl ?? null };
}

/** Loads what the summary needs. A session that cannot be read leaves the summary thinner, not missing. */
export async function getFixSummary(requestId: string, client: AiBuilderClient | null = defaultClient()): Promise<FixSummary> {
  const request = await appDb.itRequest.findUniqueOrThrow({ where: { id: requestId } });
  const errorId = request.sourceType === "error" ? request.sourceId : null;
  const error = errorId ? await appDb.errorEvent.findUnique({ where: { id: errorId } }) : null;

  let events: AiEvent[] | null = null;
  if (request.sessionId && client) {
    try {
      events = (await client.getSession(request.sessionId)).events;
    } catch {
      events = null;
    }
  }

  let since: number | null = null;
  if (error && request.liveAt) {
    const from = new Date(Math.floor(request.liveAt.getTime() / BUCKET_MS) * BUCKET_MS);
    since = (await appDb.errorBucket.aggregate({ _sum: { count: true }, where: { errorId: error.id, startsAt: { gte: from } } }))._sum.count ?? 0;
  }
  return buildFixSummary({ error, request, events, since });
}
