/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import {
  dependencyFix, ingestScan, ItActionError, listFailedFixes, openNextFindingFix, packageOf, resumeSecurityFixes, retryFailedFixes, retryFindingFix,
  securityHeadline, securityPause, securityReport, triageScan, type AiBuilderClient, type Responder,
} from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Dave Owner" }, userId: "u1", email: "dave@example.test", name: "Dave Owner", roles: ["ADMIN"] };
const tech: Responder = { ...owner, userId: "u2", roles: ["OPERATOR"], actor: { type: "USER", userId: "u2", label: "Tom Tech" } };
let seq = 0;
const f = (over: Record<string, unknown> = {}) => ({ tool: "osv", ruleId: "r", severity: "HIGH", file: "pnpm-lock.yaml", line: null, message: "undici@7.30.0: Denial of Service (fixed in 7.31.0)", fixedIn: "7.31.0", fingerprint: `osv:r:fp${String(++seq).padStart(6, "0")}`, ...over });
const scan = (scanId: string, findings: unknown[]) => ({ scanId, kind: "weekly", tools: ["osv"], findings });
let n = 0;
const client = () => ({ createSession: vi.fn(async () => ({ id: `p-${++n}`, appId: "i", intent: "maintenance", title: "t", status: "working", costUsd: 0, prUrl: null })) }) as unknown as AiBuilderClient;
const failAll = () => appDb.itRequest.updateMany({ where: { kind: "FINDING" }, data: { status: "BUILD_FAILED" } });

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("the instructions for a vulnerable dependency", () => {
  it("reads the package from the finding's message", () => {
    expect(packageOf("undici@7.30.0: Denial of Service")).toBe("undici");
    expect(packageOf("@vitest/mocker@3.2.7: Path traversal")).toBe("@vitest/mocker");
    expect(packageOf("minimist: Prototype pollution (fixed in 1.2.6)")).toBe("minimist");
    expect(packageOf("Possible secret committed")).toBeNull();
  });

  it("tells the assistant to change the version when direct, and to add an override when another package brings it in", () => {
    const text = dependencyFix("undici@7.30.0: Denial of Service", "7.31.0");
    expect(text).toContain("patched version: 7.31.0");
    expect(text).toMatch(/direct dependency.*change its version there to 7\.31\.0/);
    expect(text).toMatch(/not listed there.*overrides:.*pnpm-workspace\.yaml/);
    expect(text).toContain("'undici@<7.31.0': ^7.31.0");
    expect(text).toContain("Do not hand-write pnpm-lock.yaml");
  });

  it("is what the assistant is sent for a finding that names a version", async () => {
    await ingestScan(scan("s1", [f()]));
    const c = client();
    await triageScan("s1", c, {});
    expect((c.createSession as any).mock.calls[0][0].text).toContain("overrides:");
  });
});

describe("the pause", () => {
  it("stops after three failed fixes in a row, so a backlog is not tried one a minute", async () => {
    await ingestScan(scan("s1", Array.from({ length: 6 }, (_, i) => f({ message: `pkg${i}@1.0.0: Bad`, fixedIn: "1.0.1" }))));
    const c = client();
    for (let i = 0; i < 3; i++) {
      expect((await openNextFindingFix(c, {})).opened).toBe(true);
      await failAll();
    }
    const next = await openNextFindingFix(c, {});
    expect(next).toMatchObject({ opened: false, reason: expect.stringMatching(/paused: the last 3 all failed/) });
    expect(await appDb.itRequest.count()).toBe(3);
    expect(await securityPause({})).toMatchObject({ kind: "failures" });
  });

  it("does not pause for two failures, or when one of the last three worked", async () => {
    await ingestScan(scan("s1", Array.from({ length: 4 }, (_, i) => f({ message: `pkg${i}@1.0.0: Bad`, fixedIn: "1.0.1" }))));
    const c = client();
    for (let i = 0; i < 3; i++) {
      await openNextFindingFix(c, {});
      await appDb.itRequest.updateMany({ where: { kind: "FINDING", status: { notIn: ["MERGED", "BUILD_FAILED"] } }, data: { status: i === 1 ? "MERGED" : "BUILD_FAILED" } });
    }
    expect(await securityPause({})).toBeNull();
  });

  it("stops when the day's spending is used up, and says how much", async () => {
    await ingestScan(scan("s1", [f()]));
    await openNextFindingFix(client(), {});
    await appDb.itRequest.updateMany({ data: { costUsd: 4.5, status: "MERGED" } });
    expect(await securityPause({ IT_SECURITY_DAILY_CAP_USD: "5" })).toBeNull();
    const paused = await securityPause({ IT_SECURITY_DAILY_CAP_USD: "4" });
    expect(paused).toMatchObject({ kind: "cost", reason: expect.stringContaining("$4.00") });
    expect(await securityPause({ IT_SECURITY_DAILY_CAP_USD: "4" }, new Date(Date.now() + 2 * 86_400_000))).toBeNull(); // a day later
  });

  it("starts the count again when a person resumes", async () => {
    await ingestScan(scan("s1", Array.from({ length: 5 }, (_, i) => f({ message: `pkg${i}@1.0.0: Bad`, fixedIn: "1.0.1" }))));
    const c = client();
    for (let i = 0; i < 3; i++) {
      await openNextFindingFix(c, {});
      await failAll();
    }
    expect(await securityPause({})).not.toBeNull();
    await resumeSecurityFixes(owner, c, {});
    expect(await securityPause({})).toBeNull();
  });
});

describe("retrying failed fixes", () => {
  const failedFix = async () => {
    await ingestScan(scan("s1", [f()]));
    const c = client();
    await openNextFindingFix(c, {});
    await failAll();
    return c;
  };

  it("lists a finding whose fix failed, and the honest counts say so", async () => {
    await failedFix();
    expect(await listFailedFixes()).toHaveLength(1);
    expect(await securityHeadline()).toMatchObject({ open: 1, beingFixed: 0, failedFix: 1 });
    const report = await securityReport();
    expect(report.top[0]).toMatchObject({ fixFailed: true, hasFix: false });
  });

  it("counts a fix as being fixed only while its request is going", async () => {
    await ingestScan(scan("s1", [f()]));
    await openNextFindingFix(client(), {});
    expect(await securityHeadline()).toMatchObject({ beingFixed: 1, failedFix: 0 });
    expect((await securityReport()).top[0]).toMatchObject({ fixFailed: false, hasFix: true });
  });

  it("tries one again with a new request, and lifts the pause", async () => {
    const c = await failedFix();
    const id = (await listFailedFixes())[0]!.findingId;
    const r = await retryFindingFix(id, owner, c, {});
    expect(r.opened).toBe(true);
    expect(await appDb.itRequest.count()).toBe(2);
    expect(await listFailedFixes()).toHaveLength(0);
    expect((await appDb.finding.findUniqueOrThrow({ where: { id } })).status).toBe("FIXING");
  });

  it("refuses when another fix is under way, for a fix that has not failed, and for anyone but Owner and Office", async () => {
    const c = await failedFix();
    const id = (await listFailedFixes())[0]!.findingId;
    await expect(retryFindingFix(id, tech, c, {})).rejects.toThrow(/Owner or Office/);
    await expect(retryFindingFix("nope", owner, c, {})).rejects.toBeInstanceOf(ItActionError);
    const first = await appDb.finding.findUniqueOrThrow({ where: { id } });
    // The next scan still reports the first finding, and adds another one, which takes the lane.
    await ingestScan(scan("s2", [f({ fingerprint: first.fingerprint }), f({ message: "other@1.0.0: Bad", fixedIn: "1.0.1" })]));
    await openNextFindingFix(c, {});
    await expect(retryFindingFix(id, owner, c, {})).rejects.toThrow(/Another fix is under way/);
  });

  it("puts every failed fix back in line at once, and the queue takes them one at a time", async () => {
    await ingestScan(scan("s1", Array.from({ length: 4 }, (_, i) => f({ message: `pkg${i}@1.0.0: Bad`, fixedIn: "1.0.1" }))));
    const c = client();
    for (let i = 0; i < 3; i++) {
      await openNextFindingFix(c, {});
      await failAll();
    }
    expect((await listFailedFixes()).length).toBe(3);
    expect(await securityPause({})).not.toBeNull();
    const count = await retryFailedFixes(owner, c, {});
    expect(count).toBe(3);
    expect(await securityPause({})).toBeNull();
    // One of them is open again now; the rest wait.
    expect(await appDb.itRequest.count({ where: { status: { notIn: ["BUILD_FAILED", "CLOSED"] } } })).toBe(1);
    await expect(retryFailedFixes(tech, c, {})).rejects.toThrow(/Owner or Office/);
  });
});
