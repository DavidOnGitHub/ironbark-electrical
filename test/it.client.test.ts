import { describe, expect, it, vi } from "vitest";
import { aiBuilderConfigFromEnv, AiBuilderError, createAiBuilderClient, summarizeSession, type AiSessionDetail } from "../src/domain/it";

const config = { baseUrl: "https://builder.test", token: "tok", appId: "ironbark" };
const session = { id: "s1", appId: "ironbark", intent: "feature", title: "T", status: "pr_open", costUsd: 0.5, prUrl: "https://github.com/x/y/pull/9" };

function stub(status: number, body: unknown, raw?: string) {
  return vi.fn(async () => new Response(raw ?? JSON.stringify(body), { status }));
}
const lastCall = (f: ReturnType<typeof stub>) => {
  const [url, init] = f.mock.calls.at(-1) as unknown as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init, headers: init.headers, body: init.body ? JSON.parse(init.body as string) : undefined };
};

describe("AI Builder configuration", () => {
  it("is off unless both the URL and the token are set", () => {
    expect(aiBuilderConfigFromEnv({})).toBeNull();
    expect(aiBuilderConfigFromEnv({ AI_BUILDER_URL: "https://b.test" })).toBeNull();
    expect(aiBuilderConfigFromEnv({ AI_BUILDER_TOKEN: "x" })).toBeNull();
  });

  it("trims trailing slashes and defaults the app id", () => {
    expect(aiBuilderConfigFromEnv({ AI_BUILDER_URL: "https://b.test//", AI_BUILDER_TOKEN: " x " })).toEqual({ baseUrl: "https://b.test", token: "x", appId: "ironbark" });
  });
});

describe("AI Builder client", () => {
  it("sends the token and the app id, and no identity headers for the service itself", async () => {
    const f = stub(201, session);
    const created = await createAiBuilderClient(config, f as unknown as typeof fetch).createSession({ intent: "bugfix", text: "boom", context: { route: "/quotes" } });
    expect(created.id).toBe("s1");
    const c = lastCall(f);
    expect(c.url).toBe("https://builder.test/api/sessions");
    expect(c.headers.authorization).toBe("Bearer tok");
    expect(c.headers["x-on-behalf-of"]).toBeUndefined();
    expect(c.body).toEqual({ appId: "ironbark", intent: "bugfix", text: "boom", context: { route: "/quotes" } });
  });

  it("says who an action is for, with a role and a safe display name", async () => {
    const f = stub(200, null, "");
    await createAiBuilderClient(config, f as unknown as typeof fetch).approveSpec("s1", 2, { email: "sam@example.com", name: "Sam Léo", role: "approver" });
    const c = lastCall(f);
    expect(c.url).toBe("https://builder.test/api/sessions/s1/approve");
    expect(c.body).toEqual({ version: 2 });
    expect(c.headers["x-on-behalf-of"]).toBe("sam@example.com");
    expect(c.headers["x-on-behalf-of-role"]).toBe("approver");
    expect(c.headers["x-on-behalf-of-name"]).toBe("Sam L?o");
  });

  it("turns failures into AiBuilderError with the server's message when there is one", async () => {
    await expect(createAiBuilderClient(config, stub(403, { error: "This token cannot use the app" }) as unknown as typeof fetch).getSession("s1")).rejects.toMatchObject({ status: 403, message: "This token cannot use the app" });
    await expect(createAiBuilderClient(config, stub(502, null, "<html>bad gateway</html>") as unknown as typeof fetch).getSession("s1")).rejects.toMatchObject({ status: 502, message: "AI Builder answered 502" });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(createAiBuilderClient(config, down as unknown as typeof fetch).getSession("s1")).rejects.toMatchObject({ status: 0 });
    await expect(createAiBuilderClient(config, down as unknown as typeof fetch).getSession("s1")).rejects.toBeInstanceOf(AiBuilderError);
  });

  it("rejects a reply it does not understand", async () => {
    await expect(createAiBuilderClient(config, stub(200, { nope: true }) as unknown as typeof fetch).getSession("s1")).rejects.toMatchObject({ message: expect.stringContaining("does not understand") });
  });
});

describe("summarizing a session", () => {
  const detail = (events: AiSessionDetail["events"], acceptance: AiSessionDetail["acceptance"] = null): AiSessionDetail => ({ session, events, acceptance });

  it("takes the PR from the session and the preview of the commit being tested", () => {
    const s = summarizeSession(
      detail([
        { type: "commit_pushed", sha: "aaa" },
        { type: "preview_ready", sha: "aaa", url: "https://old.test" },
        { type: "commit_pushed", sha: "bbb" },
        { type: "preview_ready", sha: "bbb", url: "https://new.test" },
      ]),
    );
    expect(s).toEqual({ status: "pr_open", prUrl: "https://github.com/x/y/pull/9", previewUrl: "https://new.test", costUsd: 0.5 });
  });

  it("ignores a preview of an older commit", () => {
    const s = summarizeSession(detail([{ type: "preview_ready", sha: "aaa", url: "https://old.test" }, { type: "commit_pushed", sha: "bbb" }]));
    expect(s.previewUrl).toBeNull();
  });

  it("prefers the preview AI Builder reports for acceptance, and falls back to the PR event", () => {
    const s = summarizeSession({ session: { ...session, prUrl: null }, events: [{ type: "pr_opened", url: "https://github.com/x/y/pull/3" }], acceptance: { mode: "owner", sha: "bbb", ready: true, blockers: [], previewUrl: "https://acc.test" } });
    expect(s.previewUrl).toBe("https://acc.test");
    expect(s.prUrl).toBe("https://github.com/x/y/pull/3");
  });
});
