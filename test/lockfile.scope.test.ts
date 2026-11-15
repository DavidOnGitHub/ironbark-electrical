import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { outOfScope } from "../scripts/lockfile/scope.mjs";

describe("lockfile scope", () => {
  it("allows a dependency change with its spec", () => {
    expect(outOfScope(["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "specs/abc-123.md"])).toEqual([]);
  });
  it("names anything else, including registry settings, scripts, workflows and code", () => {
    expect(outOfScope([".npmrc", "package.json", ".github/workflows/ci.yml", "src/a.ts", "specs/sub/dir.md", "packages/x/package.json", "scripts/security/report.mjs"])).toEqual([".npmrc", ".github/workflows/ci.yml", "src/a.ts", "specs/sub/dir.md", "packages/x/package.json", "scripts/security/report.mjs"]);
  });
  it("ignores blank lines and surrounding spaces", () => {
    expect(outOfScope(["", "  package.json  ", "\n"])).toEqual([]);
  });
  it("exits 0 for an in-scope list and 1 for the rest, from the command line", () => {
    const run = (input: string) => spawnSync("node", ["scripts/lockfile/scope.mjs"], { input, encoding: "utf8" });
    expect(run("package.json\npnpm-lock.yaml\n").status).toBe(0);
    const bad = run("package.json\n.npmrc\n");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain(".npmrc");
    expect(run("").status).toBe(1);
    expect(execFileSync("node", ["--version"], { encoding: "utf8" })).toMatch(/^v/);
  });
});
