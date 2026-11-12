/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb } from "../src/db/app";
import { ingestScan, SCAN_COOLDOWN_MS, scanNowAvailable, startScan } from "../src/domain/it";
import { truncateAll } from "./helpers";

const env = { IT_SCAN_REPO: "owner/repo", IT_SCAN_DISPATCH_TOKEN: "ghp_secret" };
const reply = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

describe("scanNowAvailable", () => {
  it("needs a valid repository name and a token", () => {
    expect(scanNowAvailable(env)).toBe(true);
    expect(scanNowAvailable({})).toBe(false);
    expect(scanNowAvailable({ IT_SCAN_REPO: "owner/repo" })).toBe(false);
    expect(scanNowAvailable({ IT_SCAN_DISPATCH_TOKEN: "x" })).toBe(false);
    expect(scanNowAvailable({ ...env, IT_SCAN_REPO: "not a repo; rm -rf" })).toBe(false);
  });
});

describe("startScan", () => {
  it("asks GitHub to run the workflow on main and sends the token only in the header", async () => {
    const f = reply(204);
    expect(await startScan(env, { fetchImpl: f })).toEqual({ started: true });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/repo/actions/workflows/security-weekly.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer ghp_secret");
    expect(JSON.parse(init.body)).toEqual({ ref: "main" });
    expect(String(url)).not.toContain("ghp_secret");
  });

  it("does nothing when it is not set up", async () => {
    const f = reply(204);
    expect(await startScan({}, { fetchImpl: f })).toMatchObject({ started: false });
    expect(f).not.toHaveBeenCalled();
  });

  it("explains a refusal in plain words, without echoing GitHub's reply", async () => {
    expect(await startScan(env, { fetchImpl: reply(403) })).toMatchObject({ started: false, reason: expect.stringMatching(/would not allow/) });
    expect(await startScan(env, { fetchImpl: reply(404) })).toMatchObject({ started: false, reason: expect.stringMatching(/could not find/) });
    expect(await startScan(env, { fetchImpl: reply(500) })).toMatchObject({ started: false, reason: expect.stringMatching(/500/) });
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await startScan(env, { fetchImpl: down })).toMatchObject({ started: false, reason: expect.stringMatching(/Could not reach/) });
  });

  it("does not start another scan right after one finished", async () => {
    await ingestScan({ scanId: "s1", kind: "weekly", tools: ["osv"], findings: [] });
    const f = reply(204);
    const soon = await startScan(env, { fetchImpl: f });
    expect(soon).toMatchObject({ started: false, reason: expect.stringMatching(/finished a few minutes ago/) });
    expect(f).not.toHaveBeenCalled();
    const later = await startScan(env, { fetchImpl: f, now: new Date(Date.now() + SCAN_COOLDOWN_MS + 1000) });
    expect(later).toEqual({ started: true });
  });
});
