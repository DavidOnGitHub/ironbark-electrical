/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { releaseAvailable, releaseState, releaseToProduction } from "../src/domain/it";
import { truncateAll } from "./helpers";

const env = { IT_SCAN_REPO: "owner/repo", IT_RELEASE_TOKEN: "ghp_secret" };
const who = { actor: { type: "USER", userId: "u1", label: "Sam Walker" } as any, name: "Sam Walker" };

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const compare = (ahead: number) => ({ ahead_by: ahead, commits: [{ commit: { message: "Add label\n\nbody" } }, { commit: { message: "Merge pull request #5 from x/y" } }, { commit: { message: "Fix quotes list" } }].slice(0, ahead ? 3 : 0) });

/** A fake GitHub: routes by "METHOD path". */
function github(routes: Record<string, (init: any) => Response>) {
  return vi.fn(async (url: string, init: any) => {
    const key = `${init.method} ${url.replace("https://api.github.com", "").split("?")[0]}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected call ${key}`);
    return route(init);
  }) as unknown as typeof fetch;
}

describe("releaseAvailable", () => {
  it("needs a valid repository name and a release token", () => {
    expect(releaseAvailable(env)).toBe(true);
    expect(releaseAvailable({ IT_SCAN_REPO: "owner/repo" })).toBe(false);
    expect(releaseAvailable({ IT_RELEASE_TOKEN: "x" })).toBe(false);
    expect(releaseAvailable({ ...env, IT_SCAN_REPO: "bad repo; rm" })).toBe(false);
  });
});

describe("releaseState", () => {
  it("lists what is waiting without merge commits, and the open pull request", async () => {
    const f = github({ "GET /repos/owner/repo/compare/main...staging": () => json(compare(3)), "GET /repos/owner/repo/pulls": () => json([{ number: 9, html_url: "https://github.com/owner/repo/pull/9", auto_merge: { x: 1 } }]) });
    expect(await releaseState(env, { fetchImpl: f })).toEqual({ ahead: 3, changes: ["Add label", "Fix quotes list"], pr: { number: 9, url: "https://github.com/owner/repo/pull/9", autoMerge: true } });
    expect((f as any).mock.calls[0][1].headers.authorization).toBe("Bearer ghp_secret");
  });
  it("is null when it is not set up or GitHub cannot be asked", async () => {
    expect(await releaseState({}, { fetchImpl: github({}) })).toBeNull();
    expect(await releaseState(env, { fetchImpl: github({ "GET /repos/owner/repo/compare/main...staging": () => json({}, 500) }) })).toBeNull();
  });
});

describe("releaseToProduction", () => {
  const base = { "GET /repos/owner/repo/compare/main...staging": () => json(compare(3)), "GET /repos/owner/repo/pulls": () => json([]) };
  const created = { "POST /repos/owner/repo/pulls": () => json({ number: 12, html_url: "https://github.com/owner/repo/pull/12", node_id: "PR_node" }) };

  it("opens the pull request and turns on auto-merge when its checks have not passed yet", async () => {
    const f = github({ ...base, ...created, "PUT /repos/owner/repo/pulls/12/merge": () => json({}, 405), "POST /graphql": () => json({ data: {} }) });
    expect(await releaseToProduction(who, env, { fetchImpl: f })).toEqual({ ok: true, state: "waiting", url: "https://github.com/owner/repo/pull/12" });
    const post = (f as any).mock.calls.find((c: any[]) => c[1].method === "POST" && String(c[0]).endsWith("/pulls"));
    expect(JSON.parse(post[1].body)).toMatchObject({ title: "Release to production", head: "staging", base: "main" });
    expect(JSON.parse(post[1].body).body).toContain("- Add label");
    const gql = (f as any).mock.calls.find((c: any[]) => String(c[0]).endsWith("/graphql"));
    expect(JSON.parse(gql[1].body).variables).toEqual({ id: "PR_node" });
    const events = await appDb.activityEvent.findMany({ where: { entityType: "release" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toContain("will merge when its checks pass");
  });

  it("says so when it merged straight away", async () => {
    const f = github({ ...base, ...created, "PUT /repos/owner/repo/pulls/12/merge": () => json({ merged: true }) });
    expect(await releaseToProduction(who, env, { fetchImpl: f })).toMatchObject({ ok: true, state: "merged" });
  });

  it("reuses an open pull request instead of opening another", async () => {
    const f = github({ ...base, "GET /repos/owner/repo/pulls": () => json([{ number: 9, html_url: "https://github.com/owner/repo/pull/9" }]), "PUT /repos/owner/repo/pulls/9/merge": () => json({}, 405), "GET /repos/owner/repo/pulls/9": () => json({ node_id: "N9" }), "POST /graphql": () => json({ data: {} }) });
    expect(await releaseToProduction(who, env, { fetchImpl: f })).toMatchObject({ ok: true, url: "https://github.com/owner/repo/pull/9" });
  });

  it("does nothing when production already has everything", async () => {
    const f = github({ "GET /repos/owner/repo/compare/main...staging": () => json(compare(0)), "GET /repos/owner/repo/pulls": () => json([]) });
    expect(await releaseToProduction(who, env, { fetchImpl: f })).toMatchObject({ ok: false });
    expect(await appDb.activityEvent.count({ where: { entityType: "release" } })).toBe(0);
  });

  it("reports GitHub not allowing auto-merge, and a refused token, in plain words", async () => {
    const noAuto = github({ ...base, ...created, "PUT /repos/owner/repo/pulls/12/merge": () => json({}, 405), "POST /graphql": () => json({ errors: [{ message: "Auto merge is not allowed" }] }) });
    const r = await releaseToProduction(who, env, { fetchImpl: noAuto });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).reason).toContain("Allow auto-merge");
    const denied = github({ ...base, "POST /repos/owner/repo/pulls": () => json({}, 403) });
    expect(((await releaseToProduction(who, env, { fetchImpl: denied })) as any).reason).toContain("would not allow");
    expect(await appDb.activityEvent.count({ where: { entityType: "release" } })).toBe(0);
  });

  it("does not leak the token into any url", async () => {
    const f = github({ ...base, ...created, "PUT /repos/owner/repo/pulls/12/merge": () => json({ merged: true }) });
    await releaseToProduction(who, env, { fetchImpl: f });
    for (const c of (f as any).mock.calls) expect(String(c[0])).not.toContain("ghp_secret");
  });
});
