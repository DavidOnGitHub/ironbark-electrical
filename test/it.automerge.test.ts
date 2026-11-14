import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { autoMergeDependencyFixes, securityAutoMergeOn, type AiBuilderClient } from "../src/domain/it";
import { truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

const detail = (files: string[], over: { ready?: boolean; blockers?: string[]; sha?: string | null } = {}) => ({
  session: { id: "s1", appId: "i", intent: "maintenance", title: "t", status: "awaiting_acceptance", costUsd: 0, prUrl: null },
  events: [{ type: "commit_pushed", sha: "abc", files }],
  acceptance: { mode: "manual", sha: over.sha === undefined ? "abc" : over.sha, ready: over.ready ?? true, blockers: over.blockers ?? [], previewUrl: null },
});
const clientFor = (d: ReturnType<typeof detail>) => ({ getSession: vi.fn(async () => d), accept: vi.fn(async () => undefined) }) as unknown as AiBuilderClient & { accept: ReturnType<typeof vi.fn> };
const request = (over: Record<string, unknown> = {}) =>
  appDb.itRequest.create({ data: { number: `IT-${Math.floor(Math.random() * 1e6)}`, kind: "FINDING", sourceType: "finding", intent: "maintenance", title: "t", description: "d", status: "PR_OPEN", sessionId: "s1", requestedByLabel: "IT assistant", ...over } });

describe("automatic merge of scan-driven dependency fixes", () => {
  it("merges a ready dependency fix without anyone accepting it", async () => {
    await request();
    const c = clientFor(detail(["pnpm-workspace.yaml", "pnpm-lock.yaml", "specs/it-1.md"]));
    expect(await autoMergeDependencyFixes(c, {})).toBe(1);
    expect(c.accept).toHaveBeenCalledWith("s1", "abc", expect.objectContaining({ role: "approver" }));
  });

  it("waits while the change is not ready", async () => {
    await request();
    for (const d of [detail(["pnpm-lock.yaml"], { ready: false }), detail(["pnpm-lock.yaml"], { blockers: ["checks"] }), detail(["pnpm-lock.yaml"], { sha: null })]) {
      const c = clientFor(d);
      expect(await autoMergeDependencyFixes(c, {})).toBe(0);
      expect(c.accept).not.toHaveBeenCalled();
    }
  });

  it("never merges anything that is more than dependency files, or only a spec", async () => {
    await request();
    for (const files of [["pnpm-lock.yaml", "src/app.ts"], ["pnpm-lock.yaml", ".npmrc"], ["specs/it-1.md"], ["render.yaml"]]) {
      const c = clientFor(detail(files));
      expect(await autoMergeDependencyFixes(c, {})).toBe(0);
      expect(c.accept).not.toHaveBeenCalled();
    }
  });

  it("leaves errors, features and requests held for a developer to a person", async () => {
    await request({ kind: "ERROR", sourceType: "error" });
    await request({ kind: "FEATURE", sourceType: null, intent: "feature", sessionId: "s2" });
    await request({ needsDeveloper: true, sessionId: "s3" });
    const c = clientFor(detail(["pnpm-lock.yaml"]));
    expect(await autoMergeDependencyFixes(c, {})).toBe(0);
    expect(c.accept).not.toHaveBeenCalled();
  });

  it("can be switched off", async () => {
    expect(securityAutoMergeOn({})).toBe(true);
    expect(securityAutoMergeOn({ IT_SECURITY_AUTOMERGE: " OFF " })).toBe(false);
    await request();
    const c = clientFor(detail(["pnpm-lock.yaml"]));
    expect(await autoMergeDependencyFixes(c, { IT_SECURITY_AUTOMERGE: "off" })).toBe(0);
  });
});
