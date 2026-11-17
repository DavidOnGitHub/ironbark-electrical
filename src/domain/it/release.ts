/**
 * "Release to production": moves what is on staging into main. Accepting a change merges it to staging; this is the second
 * approval. The Owner's click here is the approval: the app opens the promotion pull request (staging into main) and asks
 * GitHub to merge it by itself once its required checks pass, so nobody needs a GitHub account and the branch rules still
 * decide. GitHub is the source of truth for what is waiting and what happened; nothing is stored here but the activity entry.
 *
 * Needs IT_SCAN_REPO (owner/name) and IT_RELEASE_TOKEN: a fine-grained token on that one repository with Contents: read and
 * write, Pull requests: read and write. The repository must allow auto-merge. Without both the panel is not shown.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";

type Env = Record<string, string | undefined>;

const GITHUB = "https://api.github.com";
const MAX_COMMITS = 15;

export const releaseAvailable = (env: Env = process.env): boolean => Boolean(env.IT_SCAN_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.IT_SCAN_REPO) && env.IT_RELEASE_TOKEN);

const branches = (env: Env) => ({ head: env.IT_RELEASE_HEAD?.trim() || "staging", base: env.IT_RELEASE_BASE?.trim() || "main" });

export interface ReleaseState {
  /** How many commits staging is ahead of main. */
  ahead: number;
  /** The subject line of each waiting change, oldest first (merge commits are left out). */
  changes: string[];
  /** The promotion pull request, when one is open. */
  pr: { number: number; url: string; autoMerge: boolean } | null;
}

export type ReleaseResult = { ok: true; state: "waiting" | "merged"; url: string } | { ok: false; reason: string };

class GithubRefused extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`);
  }
}

function client(env: Env, fetchImpl: typeof fetch) {
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${env.IT_RELEASE_TOKEN}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${GITHUB}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!res.ok) throw new GithubRefused(res.status);
    return res.status === 204 ? null : res.json();
  };
}

const plainReason = (err: unknown): string => {
  if (err instanceof GithubRefused) {
    if (err.status === 401 || err.status === 403) return "GitHub would not allow it. The release token may have expired or lacks permission to open and merge pull requests.";
    if (err.status === 404) return "GitHub could not find the repository or branches. Check the release settings.";
    return `GitHub answered ${err.status}. Try again in a minute.`;
  }
  return "Could not reach GitHub. Try again in a minute.";
};

/** What is waiting to be released, asked of GitHub. Null when it is not set up or GitHub could not be asked. */
export async function releaseState(env: Env = process.env, opts: { fetchImpl?: typeof fetch } = {}): Promise<ReleaseState | null> {
  if (!releaseAvailable(env)) return null;
  const call = client(env, opts.fetchImpl ?? fetch);
  const repo = env.IT_SCAN_REPO!;
  const { head, base } = branches(env);
  try {
    const compare = (await call("GET", `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`)) as { ahead_by?: number; commits?: { commit?: { message?: string } }[] };
    const changes = (compare.commits ?? [])
      .map((c) => (c.commit?.message ?? "").split("\n")[0]!.trim())
      .filter((m) => m && !/^Merge (pull request|branch)/.test(m))
      .slice(-MAX_COMMITS);
    const owner = repo.split("/")[0];
    const prs = (await call("GET", `/repos/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}`)) as { number: number; html_url: string; auto_merge?: unknown }[];
    const pr = prs[0] ? { number: prs[0].number, url: prs[0].html_url, autoMerge: Boolean(prs[0].auto_merge) } : null;
    return { ahead: compare.ahead_by ?? 0, changes, pr };
  } catch {
    return null;
  }
}

/**
 * The Owner's approval: opens the promotion pull request (or reuses the open one) and turns on auto-merge, so it merges as
 * soon as the required checks pass. Never throws: a refusal comes back as a plain reason.
 */
export async function releaseToProduction(who: { actor: Actor; name: string | null }, env: Env = process.env, opts: { fetchImpl?: typeof fetch } = {}): Promise<ReleaseResult> {
  if (!releaseAvailable(env)) return { ok: false, reason: "Releasing from here is not set up." };
  const state = await releaseState(env, opts);
  if (!state) return { ok: false, reason: "Could not ask GitHub what is waiting. Try again in a minute." };
  if (state.ahead === 0 && !state.pr) return { ok: false, reason: "Nothing is waiting: production already has everything." };
  const call = client(env, opts.fetchImpl ?? fetch);
  const repo = env.IT_SCAN_REPO!;
  const { head, base } = branches(env);
  try {
    let pr = state.pr ? { number: state.pr.number, url: state.pr.url, nodeId: "" } : null;
    if (!pr) {
      const body = ["Released from Ironbark by the Owner's approval.", "", ...state.changes.map((c) => `- ${c}`), "", `Approved by ${who.name ?? "the Owner"} in the IT assistant.`].join("\n");
      const created = (await call("POST", `/repos/${repo}/pulls`, { title: "Release to production", head, base, body })) as { number: number; html_url: string; node_id: string };
      pr = { number: created.number, url: created.html_url, nodeId: created.node_id };
    }
    let merged = false;
    try {
      await call("PUT", `/repos/${repo}/pulls/${pr.number}/merge`, { merge_method: "merge" });
      merged = true;
    } catch (err) {
      // 405 or 409: its checks have not passed yet (the normal case); anything else is a real refusal.
      if (!(err instanceof GithubRefused) || (err.status !== 405 && err.status !== 409)) throw err;
    }
    if (!merged && !state.pr?.autoMerge) {
      if (!pr.nodeId) pr.nodeId = ((await call("GET", `/repos/${repo}/pulls/${pr.number}`)) as { node_id: string }).node_id;
      const gql = (await call("POST", "/graphql", { query: "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { pullRequest { number } } }", variables: { id: pr.nodeId } })) as { errors?: unknown[] };
      if (gql.errors?.length) return { ok: false, reason: `The release pull request is open (${pr.url}) but GitHub would not set it to merge by itself. Allow auto-merge on the repository, or merge it there.` };
    }
    await appDb.$transaction((tx) => recordActivity(tx, { actor: who.actor, entityType: "release", entityId: "production", kind: "RELEASED", summary: `Release to production approved: ${merged ? "merged" : "will merge when its checks pass"} (#${pr.number})`, body: state.changes.join("\n") || null }));
    return { ok: true, state: merged ? "merged" : "waiting", url: pr.url };
  } catch (err) {
    return { ok: false, reason: plainReason(err) };
  }
}
