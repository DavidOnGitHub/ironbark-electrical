import { describe, expect, it } from "vitest";
import { INDUSTRIES, MODULES, findIndustry } from "../src/content/industries";

describe("works-for notes", () => {
  it("every industry covers every module, with real text", () => {
    for (const i of INDUSTRIES) {
      for (const m of MODULES) {
        expect(i.mapping[m].theirs.length, `${i.id}/${m} name`).toBeGreaterThan(2);
        expect(i.mapping[m].note.length, `${i.id}/${m} note`).toBeGreaterThan(20);
      }
      expect(i.customise.length).toBeGreaterThan(0);
      expect(i.firstAutomation.length).toBeGreaterThan(20);
    }
  });
  it("ids are unique and lookups work", () => {
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(INDUSTRIES.length);
    expect(findIndustry("clinic")?.id).toBe("clinic");
    expect(findIndustry("nope")).toBeUndefined();
    expect(findIndustry(undefined)).toBeUndefined();
  });
  it("uses plain dashes only", () => {
    expect(JSON.stringify(INDUSTRIES)).not.toContain("—");
  });
});
