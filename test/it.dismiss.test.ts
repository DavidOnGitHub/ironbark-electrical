/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { dismissFinding, ingestScan, ItActionError, laneBusy, listDismissedFindings, openNextFindingFix, reopenFinding, securityHeadline, type AiBuilderClient, type Responder } from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Dave Owner" }, userId: "u1", email: "dave@example.test", name: "Dave Owner", roles: ["ADMIN"] };
const tech: Responder = { ...owner, userId: "u2", roles: ["OPERATOR"], actor: { type: "USER", userId: "u2", label: "Tom Tech" } };
const f = (over: Record<string, unknown> = {}) => ({ tool: "semgrep", ruleId: "r", severity: "HIGH", file: "src/a.ts", line: 1, message: "Unsafe thing", fingerprint: `semgrep:r:${Math.random().toString(36).slice(2, 12)}`, ...over });
const scan = (scanId: string, findings: unknown[]) => ({ scanId, kind: "weekly", tools: ["semgrep"], findings });
let n = 0;
const client = (closeOnCancel = true) =>
  ({
    createSession: vi.fn(async () => ({ id: `d-${++n}`, appId: "i", intent: "bugfix", title: "t", status: "working", costUsd: 0, prUrl: null })),
    cancel: vi.fn(async () => undefined),
    getSession: vi.fn(async (id: string) => ({ session: { id, appId: "i", intent: "bugfix", title: "t", status: closeOnCancel ? "closed" : "working", costUsd: 0, prUrl: null }, events: [], acceptance: null })),
  }) as unknown as AiBuilderClient;
const first = () => appDb.finding.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("dismissFinding", () => {
  it("accepts a risk with a reason, takes it out of the open count, and records who and why", async () => {
    await ingestScan(scan("s1", [f()]));
    const row = await first();
    await dismissFinding({ id: row.id, status: "ACCEPTED_RISK", reason: "Internal tool only" }, owner, null);
    expect((await first()).status).toBe("ACCEPTED_RISK");
    expect((await securityHeadline()).open).toBe(0);
    const [d] = await listDismissedFindings();
    expect(d).toMatchObject({ status: "ACCEPTED_RISK", reason: "Internal tool only", by: "Dave Owner" });
  });

  it("needs a reason to accept a risk, but not to call something a false positive", async () => {
    await ingestScan(scan("s1", [f(), f()]));
    const [a, b] = await appDb.finding.findMany({ orderBy: { createdAt: "asc" } });
    await expect(dismissFinding({ id: a!.id, status: "ACCEPTED_RISK", reason: " " }, owner, null)).rejects.toBeInstanceOf(ItActionError);
    expect((await first()).status).toBe("OPEN");
    await dismissFinding({ id: b!.id, status: "FALSE_POSITIVE" }, owner, null);
    expect((await appDb.finding.findUniqueOrThrow({ where: { id: b!.id } })).status).toBe("FALSE_POSITIVE");
  });

  it("is for the Owner and Office only, and only for findings that are still open", async () => {
    await ingestScan(scan("s1", [f()]));
    const row = await first();
    await expect(dismissFinding({ id: row.id, status: "FALSE_POSITIVE" }, tech, null)).rejects.toThrow(/Owner or Office/);
    await expect(dismissFinding({ id: row.id, status: "FIXED", reason: "x" }, owner, null)).rejects.toBeInstanceOf(ItActionError);
    await dismissFinding({ id: row.id, status: "FALSE_POSITIVE" }, owner, null);
    await expect(dismissFinding({ id: row.id, status: "FALSE_POSITIVE" }, owner, null)).rejects.toThrow(/already closed/);
    await expect(dismissFinding({ id: "nope", status: "FALSE_POSITIVE" }, owner, null)).rejects.toThrow(/not found/);
  });

  it("calls off a fix that is under way and frees the security lane for the next finding", async () => {
    await ingestScan(scan("s1", [f({ message: "First", severity: "CRITICAL" }), f({ message: "Second" })]));
    const c = client();
    expect((await openNextFindingFix(c, {})).opened).toBe(true);
    const row = await first();
    expect(row.status).toBe("FIXING");
    expect(await laneBusy("FINDING")).not.toBeNull();

    await dismissFinding({ id: row.id, status: "ACCEPTED_RISK", reason: "Not reachable" }, owner, c);
    expect((c as any).cancel).toHaveBeenCalledTimes(1);
    expect(await laneBusy("FINDING")).toBeNull();
    expect((await first()).status).toBe("ACCEPTED_RISK");
    // The next finding is now next in line.
    expect((await openNextFindingFix(c, {})).opened).toBe(true);
    expect(await appDb.itRequest.count()).toBe(2);
  });

  it("closes a request the assistant never picked up, without calling AI Builder", async () => {
    await ingestScan(scan("s1", [f()]));
    const noSession = { createSession: vi.fn(async () => { throw new Error("down"); }) } as unknown as AiBuilderClient;
    await openNextFindingFix(noSession, {});
    expect((await appDb.itRequest.findFirstOrThrow()).sessionId).toBeNull();
    const c = client();
    await dismissFinding({ id: (await first()).id, status: "FALSE_POSITIVE" }, owner, c);
    expect((c as any).cancel).not.toHaveBeenCalled();
    expect((await appDb.itRequest.findFirstOrThrow()).status).toBe("CLOSED");
    expect(await laneBusy("FINDING")).toBeNull();
  });

  it("changes nothing when the fix cannot be called off", async () => {
    await ingestScan(scan("s1", [f()]));
    await openNextFindingFix(client(), {});
    await expect(dismissFinding({ id: (await first()).id, status: "FALSE_POSITIVE" }, owner, null)).rejects.toThrow(/not connected/);
    expect((await first()).status).toBe("FIXING");
  });

  it("stays dismissed when a later scan reports the same finding again", async () => {
    const same = f({ fingerprint: "semgrep:r:stable-print" });
    await ingestScan(scan("s1", [same]));
    await dismissFinding({ id: (await first()).id, status: "ACCEPTED_RISK", reason: "Fine" }, owner, null);
    await ingestScan(scan("s2", [same]));
    expect((await first()).status).toBe("ACCEPTED_RISK");
    expect((await openNextFindingFix(client(), {})).opened).toBe(false); // never sent to the assistant
  });
});

describe("reopenFinding", () => {
  it("puts a dismissed finding back as open and in line for a fix", async () => {
    await ingestScan(scan("s1", [f()]));
    const id = (await first()).id;
    await expect(reopenFinding(id, owner)).rejects.toThrow(/not dismissed/);
    await dismissFinding({ id, status: "FALSE_POSITIVE" }, owner, null);
    await expect(reopenFinding(id, tech)).rejects.toThrow(/Owner or Office/);
    await reopenFinding(id, owner);
    expect(await first()).toMatchObject({ status: "OPEN", itRequestId: null });
    expect((await openNextFindingFix(client(), {})).opened).toBe(true);
    expect(await listDismissedFindings()).toHaveLength(0);
  });
});
