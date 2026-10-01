import { describe, expect, it } from "vitest";
import { duplicateReasons, matchKey, normalizeEmail, normalizePhone } from "../src/domain/clients/normalize";

describe("normalizePhone", () => {
  it("treats common Australian formats as the same number", () => {
    const forms = ["0412 345 678", "0412345678", "+61 412 345 678", "+61412345678", "0061 412 345 678", "(04) 1234 5678"];
    for (const f of forms) expect(normalizePhone(f), f).toBe("0412345678");
  });
  it("handles landlines", () => {
    expect(normalizePhone("(02) 9876 5432")).toBe("0298765432");
    expect(normalizePhone("+61 2 9876 5432")).toBe("0298765432");
  });
  it("returns null for blank or too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => expect(normalizeEmail("  Sam.Walker@Example.COM ")).toBe("sam.walker@example.com"));
  it("returns null for blank", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("duplicateReasons", () => {
  const a = matchKey({ email: "Pat@Example.com", phone: "0412 345 678" });
  it("matches on email, phone, or both", () => {
    expect(duplicateReasons(a, matchKey({ email: "pat@example.com" }))).toEqual(["email"]);
    expect(duplicateReasons(a, matchKey({ phone: "+61412345678" }))).toEqual(["phone"]);
    expect(duplicateReasons(a, matchKey({ email: "pat@example.com", phone: "0412345678" }))).toEqual(["email", "phone"]);
  });
  it("never matches on missing values", () => {
    expect(duplicateReasons(matchKey({}), matchKey({}))).toEqual([]);
    expect(duplicateReasons(a, matchKey({ email: "other@example.com", phone: "0499 999 999" }))).toEqual([]);
  });
});
