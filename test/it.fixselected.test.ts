/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { dependencyFix, dismissFindings, fixSelectedFindings, ingestScan, ItActionError, MAX_FIX_UNITS, packageOf, securityPause, type AiBuilderClient, type Responder } from "../src/domain/it";
import { truncateAll } from "./helpers";

const owner: Responder = { actor: { type: "USER", userId: "u1", label: "Dave Owner" }, userId: "u1", email: "dave@example.test", name: "Dave Owner", roles: ["ADMIN"] };
const tech: Responder = { ...owner, userId: "u2", roles: ["OPERATOR"], actor: { type: "USER", userId: "u2", label: "Tom Tech" } };
let n = 0;
const dep = (pkg: string, fixedIn: string | null, over: Record<string, unknown> = {}) => ({ tool: "osv", ruleId: `GHSA-${pkg}-${++n}`, severity: "HIGH", file: "pnpm-lock.yaml", message: `${pkg}@1.0.0: A problem`, fixedIn, fingerprint: `osv:GHSA-${pkg}-${n}:${pkg}`, ...over });
const code = (over: Record<string, unknown> = {}) => ({ tool: "semgrep", ruleId: "r", severity: "HIGH", file: "src/a.ts", line: 3, message: "Unsafe thing", fingerprint: `semgrep:r:${++n}aaaaaaaaaa`, ...over });
const scan = (findings: unknown[]) => ({ scanId: `s${++n}`, kind: "weekly", tools: ["osv", "semgrep", "gitleaks"], findings });
const client = () =>
  ({
    createSession: vi.fn(async () => ({ id: `f-${++n}`, appId: "i", intent: "maintenance", title: "t", status: "working", costUsd: 0, prUrl: null })),
    cancel: vi.fn(async () => undefined),
    getSession: vi.fn(),
  }) as unknown as AiBuilderClient;
const idsOf = async (where: Record<string, unknown> = {}) => (await appDb.finding.findMany({ where: where as any })).map((f) => f.id);

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("a scan only reports", () => {
  it("opens nothing by itself", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), code()]));
    expect(await appDb.itRequest.count()).toBe(0);
    expect(await appDb.finding.count({ where: { status: "OPEN" } })).toBe(2);
  });
});

describe("fixSelectedFindings", () => {
  it("fixes several packages in one request, not one each", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("undici", "7.32.1"), dep("tinypool", "2.1.2"), dep("vite", "7.3.7")]));
    const c = client();
    const r = await fixSelectedFindings(await idsOf(), owner, c, {});
    expect(r).toMatchObject({ opened: true, skipped: [] });
    expect(await appDb.itRequest.count()).toBe(1);
    expect(c.createSession).toHaveBeenCalledTimes(1);
    const req = await appDb.itRequest.findFirstOrThrow();
    expect(req).toMatchObject({ kind: "FINDING", intent: "maintenance", sourceType: "finding", requestedByEmail: "dave@example.test" });
    expect(req.title).toBe("Security: update 3 packages (undici, tinypool, vite)");
    const text = (c.createSession as any).mock.calls[0][0].text as string;
    expect(text).toContain("- undici: install 7.32.1"); // the highest of its advisories
    expect(text).toContain("- tinypool: install 2.1.2");
    expect(text).toContain("- vite: install 7.3.7");
    expect(text).toContain("Do not hand-write pnpm-lock.yaml");
    expect((c.createSession as any).mock.calls[0][0].context.findings).toHaveLength(4);
    expect(await appDb.finding.count({ where: { status: "FIXING", itRequestId: req.id } })).toBe(4);
  });

  it("names the package in the title when it is only one", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("undici", "7.32.1")]));
    await fixSelectedFindings(await idsOf(), owner, client(), {});
    expect((await appDb.itRequest.findFirstOrThrow()).title).toBe("Security: undici: 2 advisories");
  });

  it("is for the Owner and Office only", async () => {
    await ingestScan(scan([dep("undici", "7.31.0")]));
    await expect(fixSelectedFindings(await idsOf(), tech, client(), {})).rejects.toThrow(/Owner or Office/);
    expect(await appDb.itRequest.count()).toBe(0);
  });

  it("asks for at least one finding", async () => {
    expect(await fixSelectedFindings([], owner, client(), {})).toMatchObject({ opened: false, reason: "Choose at least one finding." });
  });

  it("leaves a leaked secret out, because changing the code would not undo it", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), { tool: "gitleaks", ruleId: "aws", severity: "HIGH", message: "Possible secret", fingerprint: "gitleaks:aws:aaaaaaaa" }]));
    const r = await fixSelectedFindings(await idsOf(), owner, client(), {});
    expect(r.opened).toBe(true);
    expect(r.skipped).toEqual([{ id: expect.any(String), reason: expect.stringMatching(/rotated by a person/) }]);
    expect((await appDb.finding.findFirstOrThrow({ where: { tool: "gitleaks" } })).status).toBe("OPEN");
  });

  it("fixes findings below high severity when a person chooses them", async () => {
    await ingestScan(scan([dep("fast-uri", "3.1.9", { severity: "LOW" })]));
    expect((await fixSelectedFindings(await idsOf(), owner, client(), {})).opened).toBe(true);
  });

  it("asks for a bugfix when a code finding is in the selection", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), code()]));
    const c = client();
    await fixSelectedFindings(await idsOf(), owner, c, {});
    expect((await appDb.itRequest.findFirstOrThrow()).intent).toBe("bugfix");
    const text = (c.createSession as any).mock.calls[0][0].text as string;
    expect(text).toContain("- undici: install 7.31.0");
    expect(text).toContain("add a failing test");
  });

  it("will not take on another while one is under way", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("vite", "7.3.7")]));
    const [a, b] = await idsOf();
    await fixSelectedFindings([a!], owner, client(), {});
    const second = await fixSelectedFindings([b!], owner, client(), {});
    expect(second).toMatchObject({ opened: false, reason: expect.stringMatching(/Another security fix is under way/) });
    expect(await appDb.itRequest.count()).toBe(1);
  });

  it("leaves out what is already being fixed or closed", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("vite", "7.3.7")]));
    const [a, b] = await idsOf();
    await fixSelectedFindings([a!], owner, client(), {});
    await appDb.itRequest.updateMany({ data: { status: "MERGED" } }); // lane free again; the first is still FIXING
    await dismissFindings({ ids: [b!], status: "FALSE_POSITIVE" }, owner, null);
    const r = await fixSelectedFindings([a!, b!], owner, client(), {});
    expect(r).toMatchObject({ opened: false, reason: "None of those can be fixed now." });
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["Already being fixed", "Already closed"]);
  });

  it("lets a fix that failed be chosen again", async () => {
    await ingestScan(scan([dep("undici", "7.31.0")]));
    await fixSelectedFindings(await idsOf(), owner, client(), {});
    const first = await appDb.itRequest.findFirstOrThrow();
    await appDb.itRequest.update({ where: { id: first.id }, data: { status: "BUILD_FAILED" } });
    const r = await fixSelectedFindings(await idsOf(), owner, client(), {});
    expect(r.opened).toBe(true);
    expect((await appDb.itRequest.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CLOSED");
    const again = await appDb.finding.findFirstOrThrow();
    expect(again).toMatchObject({ status: "FIXING", itRequestId: r.requestId });
  });

  it("refuses a selection too large for one change", async () => {
    await ingestScan(scan(Array.from({ length: MAX_FIX_UNITS + 1 }, (_, i) => dep(`pkg${i}`, "1.0.1"))));
    const r = await fixSelectedFindings(await idsOf(), owner, client(), {});
    expect(r).toMatchObject({ opened: false, reason: expect.stringMatching(new RegExp(`${MAX_FIX_UNITS + 1} separate fixes`)) });
    expect(await appDb.itRequest.count()).toBe(0);
  });

  it("stops when the day's spending limit is used up", async () => {
    await ingestScan(scan([dep("undici", "7.31.0")]));
    await appDb.itRequest.create({ data: { number: "IT-9000", kind: "FINDING", title: "t", description: "d", status: "LIVE", requestedByLabel: "x", costUsd: 4 } });
    expect(await securityPause({ IT_SECURITY_DAILY_CAP_USD: "5" })).toBeNull();
    const r = await fixSelectedFindings(await idsOf(), owner, client(), { IT_SECURITY_DAILY_CAP_USD: "4" });
    expect(r).toMatchObject({ opened: false, reason: expect.stringMatching(/limit of \$4\.00 is used up/) });
  });
});

describe("dismissFindings", () => {
  it("accepts the risk of several findings with one reason", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("vite", "7.3.7"), code()]));
    const r = await dismissFindings({ ids: await idsOf(), status: "ACCEPTED_RISK", reason: "Internal tool only" }, owner, null);
    expect(r).toEqual({ done: 3, failed: [] });
    expect(await appDb.finding.count({ where: { status: "ACCEPTED_RISK" } })).toBe(3);
  });

  it("needs a reason to accept a risk, and says so once, saving nothing", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("vite", "7.3.7")]));
    await expect(dismissFindings({ ids: await idsOf(), status: "ACCEPTED_RISK", reason: " " }, owner, null)).rejects.toBeInstanceOf(ItActionError);
    expect(await appDb.finding.count({ where: { status: "OPEN" } })).toBe(2);
  });

  it("marks several as false positives without a reason, and reports the ones that could not be saved", async () => {
    await ingestScan(scan([dep("undici", "7.31.0"), dep("vite", "7.3.7")]));
    const ids = await idsOf();
    await dismissFindings({ ids: [ids[0]!], status: "FALSE_POSITIVE" }, owner, null);
    const r = await dismissFindings({ ids, status: "FALSE_POSITIVE" }, owner, null);
    expect(r.done).toBe(1);
    expect(r.failed).toEqual([{ id: ids[0], reason: expect.stringMatching(/already closed/) }]);
  });

  it("is for the Owner and Office only", async () => {
    await ingestScan(scan([dep("undici", "7.31.0")]));
    await expect(dismissFindings({ ids: await idsOf(), status: "FALSE_POSITIVE" }, tech, null)).rejects.toThrow(/Owner or Office/);
  });
});

describe("the instructions for vulnerable dependencies", () => {
  it("reads the package from the finding's message", () => {
    expect(packageOf("undici@7.30.0: Denial of Service")).toBe("undici");
    expect(packageOf("@vitest/mocker@3.2.7: Path traversal")).toBe("@vitest/mocker");
    expect(packageOf("minimist: Prototype pollution (fixed in 1.2.6)")).toBe("minimist");
    expect(packageOf("Possible secret committed")).toBeNull();
  });

  it("tells the assistant to change the version when direct, and to add an override when another package brings it in", () => {
    const text = dependencyFix("undici@7.30.0: Denial of Service", "7.31.0");
    expect(text).toContain("- undici: install 7.31.0");
    expect(text).toMatch(/direct dependency.*change its version there/);
    expect(text).toMatch(/not listed there.*overrides:.*pnpm-workspace\.yaml/);
    expect(text).toContain("'undici@<7.31.0': ^7.31.0");
  });

  it("says so when the scan names no version", async () => {
    await ingestScan(scan([dep("undici", null)]));
    const c = client();
    await fixSelectedFindings(await idsOf(), owner, c, {});
    expect((c.createSession as any).mock.calls[0][0].text).toContain("if you cannot tell which version is patched, say so and change nothing");
  });
});
