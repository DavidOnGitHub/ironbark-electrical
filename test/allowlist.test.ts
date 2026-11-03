import { describe, expect, it } from "vitest";
import { bareAddress, canonicalEmail, inboxAlias, isAllowedRecipient, parseAllowlist } from "../src/integrations/allowlist";

const env = (v?: string) => ({ EMAIL_ALLOWLIST: v });

describe("recipient allowlist (deny by default)", () => {
  it("allows nobody when no list is set - nothing is sent automatically", () => {
    expect(isAllowedRecipient("anyone@example.com", env())).toBe(false);
    expect(isAllowedRecipient("anyone@example.com", env("  "))).toBe(false);
  });
  it("allows exact addresses and whole domains", () => {
    const e = env("owner@gmail.com, @ironbark.test");
    expect(isAllowedRecipient("owner@gmail.com", e)).toBe(true);
    expect(isAllowedRecipient("Pat@Ironbark.test", e)).toBe(true);
    expect(isAllowedRecipient("stranger@example.com", e)).toBe(false);
    expect(isAllowedRecipient("someone@notironbark.test", e)).toBe(false);
  });
  it("treats Gmail plus-tags and dots as the same mailbox", () => {
    const e = env("owner@gmail.com");
    expect(isAllowedRecipient("owner+pat@gmail.com", e)).toBe(true);
    expect(isAllowedRecipient("o.wner+x@googlemail.com", e)).toBe(true);
    expect(isAllowedRecipient("other+pat@gmail.com", e)).toBe(false);
  });
  it("does not apply Gmail rules to other domains", () => {
    const e = env("a.b@example.com");
    expect(isAllowedRecipient("ab@example.com", e)).toBe(false);
    expect(isAllowedRecipient("a.b+tag@example.com", e)).toBe(true);
  });
  it("works on 'Name <address>' as it arrives in a From header", () => {
    expect(isAllowedRecipient("Pat Smith <owner+pat@gmail.com>", env("owner@gmail.com"))).toBe(true);
    expect(bareAddress("Pat Smith <PAT@x.com>")).toBe("pat@x.com");
  });
  it("'*' allows everyone, but only when written explicitly; an empty address is never allowed", () => {
    expect(isAllowedRecipient("anyone@anywhere.org", env("*"))).toBe(true);
    expect(isAllowedRecipient("", env("*"))).toBe(false);
  });
  it("parses the list tidily and builds the inbox alias", () => {
    expect(parseAllowlist(" A@x.com ,, @y.org ")).toEqual(["a@x.com", "@y.org"]);
    expect(canonicalEmail("Dav.id+x@Gmail.com")).toBe("david@gmail.com");
    expect(inboxAlias("owner@gmail.com")).toBe("owner+ironbark@gmail.com");
    expect(inboxAlias("owner+old@gmail.com", "demo")).toBe("owner+demo@gmail.com");
  });
});
