/**
 * Follows a merged change until it is running. Merged is not live: the host builds and starts the new version, and a
 * failure leaves the old one running while the merged code blocks every later deploy. This asks the host (Render)
 * what happened to the deploy of each merged change, marks the request Live or Deploy failed, and on a failure opens
 * a fix request for the assistant, with the build log, which goes through the same tested pull request and acceptance.
 */
import type { ItRequest } from "ironbark-electrical-client";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { AiBuilderClient } from "./aiBuilder";
import { createItRequest, startItRequest } from "./index";

const SYSTEM = { type: "SYSTEM", label: "IT assistant" } as const;
/** How long a merged change may go without the host starting a deploy for it before that is treated as a failure. */
export const NO_DEPLOY_MS = 20 * 60_000;
const MAX_LOG = 4000;

// ---- The host ----

export interface RenderConfig {
  apiKey: string;
  /** The services that deploy the app (web and worker). Live means all of them. */
  serviceIds: string[];
}

/** Null when not configured (local development, tests): deploys are then not followed. */
export function renderConfigFromEnv(env: Record<string, string | undefined> = process.env): RenderConfig | null {
  const apiKey = env.RENDER_API_KEY?.trim();
  const serviceIds = (env.IT_DEPLOY_SERVICES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return apiKey && serviceIds.length > 0 ? { apiKey, serviceIds } : null;
}

export interface HostDeploy {
  id: string;
  status: string;
  commitMessage: string;
  createdAt: Date;
}

export interface HostService {
  name: string;
  dashboardUrl: string | null;
}

export interface DeployHost {
  listDeploys(serviceId: string): Promise<HostDeploy[]>;
  service(serviceId: string): Promise<HostService>;
  /** The tail of the build log of a deploy, or null when it cannot be had. Best effort. */
  buildLog(serviceId: string, deploy: HostDeploy): Promise<string | null>;
}

const BASE = "https://api.render.com/v1";

export function createRenderHost(config: RenderConfig, fetchImpl: typeof fetch = fetch): DeployHost {
  async function get(path: string): Promise<unknown> {
    const res = await fetchImpl(`${BASE}${path}`, { headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Render answered ${res.status} for ${path.split("?")[0]}`);
    return res.json();
  }
  return {
    async listDeploys(serviceId) {
      const body = (await get(`/services/${encodeURIComponent(serviceId)}/deploys?limit=20`)) as unknown;
      const items = Array.isArray(body) ? body : [];
      return items.flatMap((item) => {
        const d = ((item as { deploy?: unknown }).deploy ?? item) as { id?: string; status?: string; createdAt?: string; commit?: { message?: string } };
        if (!d.id || !d.status || !d.createdAt) return [];
        return [{ id: d.id, status: d.status, commitMessage: d.commit?.message ?? "", createdAt: new Date(d.createdAt) }];
      });
    },
    async service(serviceId) {
      const s = (await get(`/services/${encodeURIComponent(serviceId)}`)) as { name?: string; dashboardUrl?: string };
      return { name: s.name ?? serviceId, dashboardUrl: s.dashboardUrl ?? null };
    },
    async buildLog(serviceId, deploy) {
      try {
        const s = (await get(`/services/${encodeURIComponent(serviceId)}`)) as { ownerId?: string };
        if (!s.ownerId) return null;
        const start = new Date(deploy.createdAt.getTime() - 60_000).toISOString();
        const end = new Date(deploy.createdAt.getTime() + 30 * 60_000).toISOString();
        const q = `ownerId=${encodeURIComponent(s.ownerId)}&resource=${encodeURIComponent(serviceId)}&type=app&startTime=${start}&endTime=${end}&direction=backward&limit=80`;
        const body = (await get(`/logs?${q}`)) as { logs?: { message?: string }[] };
        const lines = (body.logs ?? []).map((l) => l.message ?? "").filter(Boolean).reverse();
        const text = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        return text ? text.slice(-MAX_LOG) : null;
      } catch {
        return null;
      }
    },
  };
}

// ---- Judging a deploy ----

export type ServiceDeployState = "live" | "building" | "failed" | "waiting" | "missing";

const IN_PROGRESS = ["created", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"];
const FAILED = ["build_failed", "update_failed", "pre_deploy_failed"];

/** The pull request number a merge commit message names: "Merge pull request #19 ..." or "Title (#19)". */
export const mentionsPr = (message: string, prNumber: number) => new RegExp(`(?<!\\d)#${prNumber}(?!\\d)`).test(message);

/**
 * Where the deploy of one pull request's merge stands on one service. A later deploy that went live also carries the
 * change, so it counts: a deploy that was superseded or cancelled by a newer commit is not a failure.
 */
export function judgeDeploys(deploys: HostDeploy[], prNumber: number, mergedAt: Date, now: Date = new Date()): { state: ServiceDeployState; deploy?: HostDeploy } {
  const mine = deploys.filter((d) => mentionsPr(d.commitMessage, prNumber)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = mine[0];
  if (!first) return { state: now.getTime() - mergedAt.getTime() > NO_DEPLOY_MS ? "missing" : "waiting" };
  const from = deploys.filter((d) => d.createdAt.getTime() >= first.createdAt.getTime()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const live = from.find((d) => d.status === "live" || d.status === "deactivated");
  if (live) return { state: "live", deploy: live };
  if (from.some((d) => IN_PROGRESS.includes(d.status))) return { state: "building" };
  const failed = [...from].reverse().find((d) => FAILED.includes(d.status));
  if (failed) return { state: "failed", deploy: failed };
  return { state: "building" }; // only cancelled so far: a newer commit's deploy is coming
}

// ---- Following requests ----

const prNumberOf = (prUrl: string | null) => {
  const m = prUrl?.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
};

export interface DeployCheckResult {
  checked: number;
  live: number;
  failed: number;
}

/** Moves each merged request to Live or Deploy failed once the host says so. A host failure is retried next time. */
export async function checkItDeploys(
  host: DeployHost,
  config: Pick<RenderConfig, "serviceIds">,
  ai: AiBuilderClient | null,
  opts: { now?: Date; autoFix?: boolean } = {},
): Promise<DeployCheckResult> {
  const now = opts.now ?? new Date();
  const rows = await appDb.itRequest.findMany({ where: { status: { in: ["MERGED", "DEPLOY_FAILED"] } }, orderBy: { createdAt: "asc" }, take: 50 });
  const result: DeployCheckResult = { checked: rows.length, live: 0, failed: 0 };

  for (const row of rows) {
    try {
      const mergedAt = row.mergedAt ?? now;
      if (!row.mergedAt) await appDb.itRequest.update({ where: { id: row.id }, data: { mergedAt } });
      const pr = prNumberOf(row.prUrl);
      if (pr === null) {
        await finish(row, "LIVE", "merged (its deploy could not be followed: no pull request number)");
        result.live++;
        continue;
      }

      const verdicts = [];
      for (const id of config.serviceIds) verdicts.push({ id, ...judgeDeploys(await host.listDeploys(id), pr, mergedAt, now) });
      const bad = verdicts.find((v) => v.state === "failed" || v.state === "missing");

      if (bad) {
        if (row.status === "DEPLOY_FAILED") continue;
        await markFailed(row, bad, host, ai, opts.autoFix !== false);
        result.failed++;
      } else if (verdicts.every((v) => v.state === "live")) {
        await finish(row, "LIVE", "is live");
        result.live++;
      }
    } catch (err) {
      console.error(`[it] deploy check failed for ${row.number}`, err);
    }
  }
  return result;
}

async function finish(row: ItRequest, status: "LIVE", summary: string) {
  await appDb.$transaction(async (tx) => {
    await tx.itRequest.update({ where: { id: row.id }, data: { status, deployError: null, deployUrl: null } });
    await recordActivity(tx, { actor: SYSTEM, entityType: "itRequest", entityId: row.id, kind: "STATUS_CHANGED", summary: `${row.number} ${summary}` });
  });
}

async function markFailed(row: ItRequest, bad: { id: string; state: ServiceDeployState; deploy?: HostDeploy }, host: DeployHost, ai: AiBuilderClient | null, autoFix: boolean) {
  const service = await host.service(bad.id).catch(() => ({ name: bad.id, dashboardUrl: null }));
  const reason = bad.deploy
    ? `The ${service.name} deploy ended as ${bad.deploy.status.replace(/_/g, " ")}.`
    : `${service.name} did not start a deploy for this change.`;
  const log = bad.deploy ? await host.buildLog(bad.id, bad.deploy) : null;
  const url = service.dashboardUrl ? (bad.deploy ? `${service.dashboardUrl}/deploys/${bad.deploy.id}` : service.dashboardUrl) : null;

  await appDb.$transaction(async (tx) => {
    await tx.itRequest.update({ where: { id: row.id }, data: { status: "DEPLOY_FAILED", deployError: reason, deployUrl: url } });
    await recordActivity(tx, { actor: SYSTEM, entityType: "itRequest", entityId: row.id, kind: "STATUS_CHANGED", summary: `${row.number} deploy failed: ${reason}` });
  });

  // A fix for a fix is not tried: a person looks at it. One automatic attempt per request.
  if (!autoFix || !ai || row.sourceType === "deploy" || row.deployFixId) return;
  const { request: fix } = await createItRequest(
    {
      kind: "ERROR",
      intent: "bugfix",
      title: `Deploy failed after ${row.number}: ${row.title}`.slice(0, 200),
      description: `The change ${row.number} ("${row.title}") was merged into staging, but its deploy failed. ${reason} Find out why from the build log in the context and fix the code so it builds and starts. Do not undo the change unless it cannot be made to work.`,
      context: { deploy: { reason, url, log }, change: { number: row.number, title: row.title, prUrl: row.prUrl } },
      sourceType: "deploy",
      sourceId: row.id,
    },
    { actor: SYSTEM },
  );
  await appDb.itRequest.update({ where: { id: row.id }, data: { deployFixId: fix.id } });
  await startItRequest(fix.id, ai);
}
