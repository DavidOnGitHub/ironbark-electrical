/**
 * Client for AI Builder's HTTP API, the "hands" of the IT assistant. Server-to-server: it authenticates with a
 * service token and, for things a person does (answering, approving, accepting), says who with the
 * X-On-Behalf-Of headers. AI Builder credits that person and caps the role at `approver`; this side checks
 * the person's permissions first, because AI Builder trusts it for who they are.
 */
import { z } from "zod";

export interface AiBuilderConfig {
  baseUrl: string;
  token: string;
  /** The app id Ironbark is registered under in AI Builder. */
  appId: string;
}

/** Null when not configured (local dev, tests): callers then skip the assistant instead of failing. */
export function aiBuilderConfigFromEnv(env: Record<string, string | undefined> = process.env): AiBuilderConfig | null {
  const baseUrl = env.AI_BUILDER_URL?.trim().replace(/\/+$/, "");
  const token = env.AI_BUILDER_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token, appId: env.AI_BUILDER_APP_ID?.trim() || "ironbark-electrical" };
}

export type DelegatedRole = "requester" | "approver";

/** The person an action is taken for. */
export interface OnBehalfOf {
  email: string;
  name?: string;
  role: DelegatedRole;
}

/** Owner and Office may approve plans and accept changes; everyone else can only ask. */
export function delegatedRoleFor(platformRoles: string[]): DelegatedRole {
  return platformRoles.includes("ADMIN") || platformRoles.includes("EDITOR") ? "approver" : "requester";
}

export class AiBuilderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SessionSchema = z.object({
  id: z.string(),
  appId: z.string(),
  intent: z.string(),
  title: z.string(),
  status: z.string(),
  specVersion: z.number().nullable().optional(),
  costUsd: z.number().default(0),
  branch: z.string().nullable().optional(),
  prUrl: z.string().nullable().optional(),
});
export type AiSession = z.infer<typeof SessionSchema>;

/** Only the event types Ironbark reads; others pass through untouched. */
const EventSchema = z.object({ type: z.string() }).passthrough();
export type AiEvent = z.infer<typeof EventSchema> & Record<string, unknown>;

const AcceptanceSchema = z
  .object({ mode: z.string(), sha: z.string().nullable(), ready: z.boolean(), blockers: z.array(z.string()), previewUrl: z.string().nullable() })
  .nullable();
export type AiAcceptance = z.infer<typeof AcceptanceSchema>;

const DetailSchema = z.object({ session: SessionSchema, events: z.array(EventSchema), acceptance: AcceptanceSchema.optional().default(null) });
export type AiSessionDetail = { session: AiSession; events: AiEvent[]; acceptance: AiAcceptance };

export interface CreateSessionInput {
  intent: "feature" | "bugfix" | "maintenance";
  text: string;
  /** Untrusted data from the app (route, error, finding); AI Builder frames it as data for the agent. */
  context?: Record<string, unknown>;
}

/** One answer: the options picked, and/or free text. */
export interface ItAnswer {
  questionId: string;
  selected: string[];
  other?: string;
}
export type MessageInput = { text: string } | { answers: ItAnswer[] };

export interface AiBuilderClient {
  createSession(input: CreateSessionInput, who?: OnBehalfOf): Promise<AiSession>;
  getSession(id: string): Promise<AiSessionDetail>;
  sendMessage(id: string, input: MessageInput, who: OnBehalfOf): Promise<void>;
  approveSpec(id: string, version: number, who: OnBehalfOf): Promise<void>;
  requestChanges(id: string, version: number, feedback: string, who: OnBehalfOf): Promise<void>;
  accept(id: string, sha: string, who: OnBehalfOf): Promise<void>;
  cancel(id: string, who: OnBehalfOf): Promise<void>;
}

const TIMEOUT_MS = 20_000;

export function createAiBuilderClient(config: AiBuilderConfig, fetchImpl: typeof fetch = fetch): AiBuilderClient {
  async function call<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; who?: OnBehalfOf; parse: (json: unknown) => T }): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${config.token}`, accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.who) {
      headers["x-on-behalf-of"] = opts.who.email;
      headers["x-on-behalf-of-role"] = opts.who.role;
      // Header values must be plain ASCII-safe text; the name is only for display.
      if (opts.who.name) headers["x-on-behalf-of-name"] = opts.who.name.replace(/[^\x20-\x7e]/g, "?").slice(0, 100);
    }
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new AiBuilderError(0, `Could not reach AI Builder: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON; handled below */
    }
    if (!res.ok) {
      const message = (json as { error?: unknown } | null)?.error;
      throw new AiBuilderError(res.status, typeof message === "string" ? message : `AI Builder answered ${res.status}`);
    }
    try {
      return opts.parse(json);
    } catch {
      throw new AiBuilderError(res.status, "AI Builder sent a reply this app does not understand");
    }
  }

  const none = () => undefined;
  return {
    createSession: (input, who) =>
      call("POST", "/api/sessions", { body: { appId: config.appId, ...input }, who, parse: (j) => SessionSchema.parse(j) }),
    getSession: (id) => call("GET", `/api/sessions/${encodeURIComponent(id)}`, { parse: (j) => DetailSchema.parse(j) as AiSessionDetail }),
    sendMessage: (id, input, who) => call("POST", `/api/sessions/${encodeURIComponent(id)}/messages`, { body: input, who, parse: none }),
    approveSpec: (id, version, who) => call("POST", `/api/sessions/${encodeURIComponent(id)}/approve`, { body: { version }, who, parse: none }),
    requestChanges: (id, version, feedback, who) => call("POST", `/api/sessions/${encodeURIComponent(id)}/request-changes`, { body: { version, feedback }, who, parse: none }),
    accept: (id, sha, who) => call("POST", `/api/sessions/${encodeURIComponent(id)}/accept`, { body: { sha }, who, parse: none }),
    cancel: (id, who) => call("POST", `/api/sessions/${encodeURIComponent(id)}/cancel`, { body: {}, who, parse: none }),
  };
}

/** What the sync mirrors from a session: its status, PR, the preview of the commit being tested, and the cost so far. */
export function summarizeSession(detail: AiSessionDetail): { status: string; prUrl: string | null; previewUrl: string | null; costUsd: number } {
  const { session, events, acceptance } = detail;
  const pushed = [...events].reverse().find((e) => e.type === "commit_pushed") as { sha?: string } | undefined;
  const preview = [...events].reverse().find((e) => e.type === "preview_ready" && (!pushed?.sha || e.sha === pushed.sha)) as { url?: string } | undefined;
  const opened = [...events].reverse().find((e) => e.type === "pr_opened") as { url?: string } | undefined;
  return {
    status: session.status,
    prUrl: session.prUrl ?? opened?.url ?? null,
    previewUrl: acceptance?.previewUrl ?? preview?.url ?? null,
    costUsd: session.costUsd,
  };
}
