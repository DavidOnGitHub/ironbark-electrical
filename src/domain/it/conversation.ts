/**
 * Reads an AI Builder session into what a person needs to act on: the questions waiting for an answer, the plan
 * (spec) waiting for approval, and whether the change can be accepted. Pure, so it is easy to test; the events
 * are AI Builder's own, read defensively because they cross a service boundary.
 */
import type { AiEvent, AiSessionDetail } from "./aiBuilder";

export interface ItQuestion {
  id: string;
  header?: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}

export interface ItSpec {
  version: number;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  edgeCases: string[];
  outOfScope: string[];
  /** pending: waiting for a decision; approved; changes_requested: the assistant is revising it. */
  state: "pending" | "approved" | "changes_requested";
}

export interface ItAcceptance {
  sha: string | null;
  ready: boolean;
  blockers: string[];
  previewUrl: string | null;
}

export interface ItConversation {
  questions: ItQuestion[];
  spec: ItSpec | null;
  acceptance: ItAcceptance | null;
  /** The assistant's latest message, for context. */
  lastMessage: string | null;
  /** The latest error the assistant reported. */
  lastError: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const last = <T,>(events: AiEvent[], pick: (e: AiEvent, index: number) => T | undefined): { value: T; index: number } | null => {
  for (let i = events.length - 1; i >= 0; i--) {
    const value = pick(events[i]!, i);
    if (value !== undefined) return { value, index: i };
  }
  return null;
};

function readQuestions(events: AiEvent[], status: string): ItQuestion[] {
  if (status !== "awaiting_user") return [];
  const found = last(events, (e) => (e.type === "question" && Array.isArray(e.questions) ? (e.questions as Record<string, unknown>[]) : undefined));
  if (!found) return [];
  // Answered since: nothing is waiting.
  if (events.slice(found.index + 1).some((e) => e.type === "user_answers" || e.type === "user_message")) return [];
  return found.value.map((q) => ({
    id: str(q.id),
    header: str(q.header) || undefined,
    question: str(q.question),
    options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map((o) => ({ label: str(o.label), description: str(o.description) || undefined })).filter((o) => o.label),
    multiSelect: q.multiSelect === true,
  })).filter((q) => q.id && q.question);
}

function readSpec(events: AiEvent[]): ItSpec | null {
  const found = last(events, (e) => (e.type === "spec_ready" && typeof e.spec === "object" && e.spec ? e : undefined));
  if (!found) return null;
  const e = found.value as unknown as { version?: number; spec: Record<string, unknown> };
  const version = typeof e.version === "number" ? e.version : 0;
  const after = events.slice(found.index + 1);
  const approved = after.some((x) => x.type === "spec_approved" && x.version === version);
  const changes = after.some((x) => x.type === "changes_requested" && x.version === version);
  const criteria = Array.isArray(e.spec.acceptanceCriteria) ? (e.spec.acceptanceCriteria as Record<string, unknown>[]).map((c) => str(c.text)).filter(Boolean) : [];
  return {
    version,
    title: str(e.spec.title),
    summary: str(e.spec.summary),
    acceptanceCriteria: criteria,
    edgeCases: strList(e.spec.edgeCases),
    outOfScope: strList(e.spec.outOfScope),
    state: approved ? "approved" : changes ? "changes_requested" : "pending",
  };
}

export function readConversation(detail: AiSessionDetail): ItConversation {
  const { session, events, acceptance } = detail;
  const message = last(events, (e) => (e.type === "assistant_message" ? str(e.text) : undefined));
  const error = last(events, (e) => (e.type === "error" ? str(e.message) : undefined));
  return {
    questions: readQuestions(events, session.status),
    spec: readSpec(events),
    acceptance: acceptance ? { sha: acceptance.sha, ready: acceptance.ready, blockers: acceptance.blockers, previewUrl: acceptance.previewUrl } : null,
    lastMessage: message?.value || null,
    lastError: error?.value || null,
  };
}
