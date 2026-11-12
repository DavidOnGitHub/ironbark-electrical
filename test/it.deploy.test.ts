/* eslint-disable @typescript-eslint/no-explicit-any -- host and assistant replies are dynamic JSON in these tests */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { checkItDeploys, createItRequest, createRenderHost, judgeDeploys, mentionsPr, NO_DEPLOY_MS, renderConfigFromEnv, type AiBuilderClient, type DeployHost, type HostDeploy } from "../src/domain/it";
import { truncateAll } from "./helpers";

const T0 = new Date("2026-11-05T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const deploy = (id: string, status: string, message: string, at = 0): HostDeploy => ({ id, status, commitMessage: message, createdAt: min(at) });
const merge = (n: number) => `Merge pull request #${n} from DavidOnGitHub/x\n\nTitle`;

describe("reading the host", () => {
  it("matches the pull request number exactly", () => {
    expect(mentionsPr("Merge pull request #19 from a/b", 19)).toBe(true);
    expect(mentionsPr("Add a thing (#19)", 19)).toBe(true);
    expect(mentionsPr("Merge pull request #190 from a/b", 19)).toBe(false);
    expect(mentionsPr("Merge pull request #119 from a/b", 19)).toBe(false);
  });

  it("is off unless both the key and the services are set", () => {
    expect(renderConfigFromEnv({})).toBeNull();
    expect(renderConfigFromEnv({ RENDER_API_KEY: "k" })).toBeNull();
    expect(renderConfigFromEnv({ RENDER_API_KEY: " k ", IT_DEPLOY_SERVICES: "srv-a, srv-b" })).toEqual({ apiKey: "k", serviceIds: ["srv-a", "srv-b"] });
  });

  it("reads Render's deploy list, with or without the wrapper, and sends the key", async () => {
    const body = [{ deploy: { id: "d1", status: "live", createdAt: "2026-11-05T10:00:00Z", commit: { message: "Merge pull request #5" } }, cursor: "c" }, { id: "d2", status: "build_failed", createdAt: "2026-11-05T09:00:00Z" }, { nope: true }];
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const host = createRenderHost({ apiKey: "k", serviceIds: ["srv-a"] }, f as unknown as typeof fetch);
    expect(await host.listDeploys("srv-a")).toEqual([
      { id: "d1", status: "live", commitMessage: "Merge pull request #5", createdAt: new Date("2026-11-05T10:00:00Z") },
      { id: "d2", status: "build_failed", commitMessage: "", createdAt: new Date("2026-11-05T09:00:00Z") },
    ]);
    expect((f.mock.calls[0] as any)[1].headers.authorization).toBe("Bearer k");
    const down = createRenderHost({ apiKey: "k", serviceIds: [] }, vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    await expect(down.listDeploys("srv-a")).rejects.toThrow(/401/);
    expect(await down.buildLog("srv-a", deploy("d", "build_failed", "x"))).toBeNull();
  });
});

describe("judging the deploys of one change", () => {
  const now = min(5);
  it("waits for a deploy to start, then calls it missing after 20 minutes", () => {
    expect(judgeDeploys([], 7, T0, now).state).toBe("waiting");
    expect(judgeDeploys([deploy("o", "live", merge(6), -30)], 7, T0, now).state).toBe("waiting");
    expect(judgeDeploys([], 7, T0, new Date(T0.getTime() + NO_DEPLOY_MS + 1)).state).toBe("missing");
  });

  it("follows the deploy: building, live, failed", () => {
    expect(judgeDeploys([deploy("d", "build_in_progress", merge(7), 1)], 7, T0, now).state).toBe("building");
    expect(judgeDeploys([deploy("d", "live", merge(7), 1)], 7, T0, now).state).toBe("live");
    expect(judgeDeploys([deploy("d", "build_failed", merge(7), 1)], 7, T0, now)).toMatchObject({ state: "failed", deploy: { id: "d" } });
    expect(judgeDeploys([deploy("d", "update_failed", merge(7), 1)], 7, T0, now).state).toBe("failed");
  });

  it("does not count an older live deploy as this change being live", () => {
    expect(judgeDeploys([deploy("old", "live", merge(6), -10), deploy("d", "build_in_progress", merge(7), 1)], 7, T0, now).state).toBe("building");
  });

  it("treats a deploy cancelled by a newer commit as covered once that one is live", () => {
    const cancelled = deploy("d1", "canceled", merge(7), 1);
    expect(judgeDeploys([cancelled], 7, T0, now).state).toBe("building");
    expect(judgeDeploys([cancelled, deploy("d2", "live", merge(8), 2)], 7, T0, now).state).toBe("live");
    expect(judgeDeploys([cancelled, deploy("d2", "build_in_progress", merge(8), 2)], 7, T0, now).state).toBe("building");
  });

  it("calls a failed deploy live when a later one carrying it went live (a fix)", () => {
    expect(judgeDeploys([deploy("bad", "build_failed", merge(7), 1), deploy("fix", "live", merge(9), 4)], 7, T0, now).state).toBe("live");
  });

  it("counts a deploy that was live and then replaced", () => {
    expect(judgeDeploys([deploy("d", "deactivated", merge(7), 1), deploy("n", "live", merge(8), 3)], 7, T0, now).state).toBe("live");
  });
});

const SERVICES = { serviceIds: ["web", "worker"] };
const system = { type: "SYSTEM", label: "IT assistant" } as const;

function host(deploys: Record<string, HostDeploy[]>, log: string | null = "ERR_PNPM boom"): DeployHost & { buildLog: ReturnType<typeof vi.fn> } {
  return {
    listDeploys: vi.fn(async (id: string) => deploys[id] ?? []),
    service: vi.fn(async (id: string) => ({ name: `ironbark-${id}`, dashboardUrl: `https://dash.test/${id}` })),
    buildLog: vi.fn(async () => log),
  };
}

function ai() {
  return {
    createSession: vi.fn(async () => ({ id: "fix-session", appId: "ironbark-electrical", intent: "bugfix", title: "T", status: "working", costUsd: 0, prUrl: null })),
    getSession: vi.fn(),
    sendMessage: vi.fn(),
    approveSpec: vi.fn(),
    requestChanges: vi.fn(),
    accept: vi.fn(),
    cancel: vi.fn(),
  } as unknown as AiBuilderClient & { createSession: ReturnType<typeof vi.fn> };
}

/** A merged request for pull request 7. */
async function merged(over: Record<string, unknown> = {}) {
  const { request } = await createItRequest({ kind: "FEATURE", title: "Rename panel", description: "d" }, { actor: system });
  return appDb.itRequest.update({ where: { id: request.id }, data: { status: "MERGED", sessionId: "s1", prUrl: "https://github.com/x/y/pull/7", mergedAt: T0, ...over } });
}
const row = (id: string) => appDb.itRequest.findUniqueOrThrow({ where: { id } });

beforeEach(truncateAll);
afterAll(() => appDb.$disconnect());

describe("following merged changes", () => {
  it("goes live only when every service is running the change", async () => {
    const r = await merged();
    const live = (id: string) => deploy(id, "live", merge(7), 1);
    const building = deploy("b", "build_in_progress", merge(7), 1);

    await checkItDeploys(host({ web: [live("w")], worker: [building] }), SERVICES, null, { now: min(3) });
    expect((await row(r.id)).status).toBe("MERGED");

    expect(await checkItDeploys(host({ web: [live("w")], worker: [live("k")] }), SERVICES, null, { now: min(4) })).toMatchObject({ live: 1, failed: 0 });
    expect(await row(r.id)).toMatchObject({ status: "LIVE", deployError: null });
  });

  it("marks the deploy failed, says where, and opens one fix with the log", async () => {
    const r = await merged();
    const client = ai();
    const h = host({ web: [deploy("w", "live", merge(7), 1)], worker: [deploy("k", "build_failed", merge(7), 1)] });
    expect(await checkItDeploys(h, SERVICES, client, { now: min(4) })).toMatchObject({ failed: 1 });

    const after = await row(r.id);
    expect(after).toMatchObject({ status: "DEPLOY_FAILED", deployUrl: "https://dash.test/worker/deploys/k" });
    expect(after.deployError).toMatch(/ironbark-worker deploy ended as build failed/);
    expect(after.deployFixId).toBeTruthy();

    const fix = await row(after.deployFixId!);
    expect(fix).toMatchObject({ kind: "ERROR", intent: "bugfix", sourceType: "deploy", sourceId: r.id, sessionId: "fix-session" });
    expect(fix.title).toContain(r.number);
    expect((client.createSession.mock.calls[0] as any)[0]).toMatchObject({ intent: "bugfix", context: { deploy: { log: "ERR_PNPM boom" }, change: { number: r.number } } });
  });

  it("does not open a second fix, and does not chase a failed fix", async () => {
    const r = await merged();
    const failing = host({ web: [deploy("w", "build_failed", merge(7), 1)], worker: [deploy("k", "live", merge(7), 1)] });
    const client = ai();
    await checkItDeploys(failing, SERVICES, client, { now: min(4) });
    await checkItDeploys(failing, SERVICES, client, { now: min(8) });
    expect(client.createSession).toHaveBeenCalledTimes(1);

    // The fix is itself a deploy fix: when its own deploy fails, nothing more is opened.
    const fixId = (await row(r.id)).deployFixId!;
    await appDb.itRequest.update({ where: { id: fixId }, data: { status: "MERGED", prUrl: "https://github.com/x/y/pull/9", mergedAt: T0 } });
    await checkItDeploys(host({ web: [deploy("w2", "build_failed", merge(9), 6)], worker: [deploy("k2", "live", merge(9), 6)] }), SERVICES, client, { now: min(8) });
    expect((await row(fixId)).status).toBe("DEPLOY_FAILED");
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it("leaves auto-fix off when asked, and when the assistant is not configured", async () => {
    const r = await merged();
    const failing = host({ web: [deploy("w", "build_failed", merge(7), 1)], worker: [] });
    await checkItDeploys(failing, SERVICES, ai(), { now: min(4), autoFix: false });
    expect(await row(r.id)).toMatchObject({ status: "DEPLOY_FAILED", deployFixId: null });
  });

  it("calls a change live once a fix's deploy carrying it is live", async () => {
    const r = await merged({ status: "DEPLOY_FAILED" });
    await checkItDeploys(host({ web: [deploy("w", "build_failed", merge(7), 1), deploy("f", "live", merge(9), 6)], worker: [deploy("k", "live", merge(7), 1)] }), SERVICES, null, { now: min(9) });
    expect((await row(r.id)).status).toBe("LIVE");
  });

  it("fails a change whose deploy never started", async () => {
    const r = await merged();
    await checkItDeploys(host({ web: [], worker: [] }), SERVICES, null, { now: new Date(T0.getTime() + NO_DEPLOY_MS + 60_000) });
    expect(await row(r.id)).toMatchObject({ status: "DEPLOY_FAILED", deployError: expect.stringContaining("did not start a deploy") });
  });

  it("starts the clock at the first look for a request merged before this existed, and survives a host error", async () => {
    const r = await merged({ mergedAt: null });
    const broken = { ...host({}), listDeploys: vi.fn(async () => { throw new Error("Render answered 500"); }) } as DeployHost;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await checkItDeploys(broken, SERVICES, null, { now: min(2) });
    spy.mockRestore();
    const after = await row(r.id);
    expect(after.status).toBe("MERGED");
    expect(after.mergedAt?.toISOString()).toBe(min(2).toISOString());
  });
});
