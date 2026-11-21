import { beforeEach, describe, expect, it, vi } from "vitest";

// The signed-in person, as the kit sees them. Only roles matter to the tools' gate.
const actor = vi.hoisted(() => ({ current: null as null | { id: string; roles: string[] } }));
vi.mock("@kabosh-digital/m-street-kit/auth", () => ({ currentActor: async () => actor.current }));

const { ironbarkAppAssistantTools } = await import("../src/automation/appAssistantTools");
const REFUSED = /only available to the Owner and Office/;
const tool = (name: string) => ironbarkAppAssistantTools.find((t) => t.name === name)!;

describe("app assistant tools - Owner and Office only", () => {
  beforeEach(() => {
    actor.current = null;
  });

  it.each([
    ["signed out", null],
    ["a Technician", { id: "u1", roles: ["OPERATOR"] }],
    ["a Bookkeeper", { id: "u2", roles: ["VIEWER"] }],
  ])("refuses every tool for %s", async (_who, who) => {
    actor.current = who;
    for (const t of ironbarkAppAssistantTools) {
      await expect(t.handler({}), t.name).rejects.toThrow(REFUSED);
    }
  });

  it.each([
    ["the Owner", ["ADMIN"]],
    ["Office", ["EDITOR"]],
  ])("answers for %s", async (_who, roles) => {
    actor.current = { id: "u3", roles };
    await expect(tool("listPriceItems").handler({})).resolves.toBeDefined();
  });
});
