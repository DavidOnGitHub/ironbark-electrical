import { describe, expect, it } from "vitest";
import { findPlaceholders, renderEmail, slugKey, substitute } from "../src/domain/emailTemplates/render";

const brand = { name: "Ironbark Electrical", phone: "(02) 5550 0142" };

describe("email template rendering", () => {
  it("finds placeholders once each, in order", () => {
    expect(findPlaceholders("Hi {{name}}, {{ number }} and {{name}}", "{{total}}")).toEqual(["name", "number", "total"]);
  });
  it("fills variables and reports absent ones, leaving them visible; an empty value is allowed", () => {
    expect(substitute("Hi {{name}} {{x}} [{{y}}]", { name: "Pat", y: "" })).toEqual({ text: "Hi Pat {{x}} []", missing: ["x"] });
    expect(substitute("{{n}}", { n: 0 }).missing).toEqual([]);
  });
  it("renders paragraphs, bullets, bold, italic and links", () => {
    const r = renderEmail({ subject: "Quote {{number}}", body: "Hi {{name}},\n\nHere is **your quote**:\n\n- Lights *x2*\n- Switch\n\nSecond line\nthird line" }, { number: "Q-1", name: "Pat" }, brand);
    expect(r.subject).toBe("Quote Q-1");
    expect(r.html).toContain("<strong>your quote</strong>");
    expect(r.html).toContain("<em>x2</em>");
    expect(r.html.match(/<li /g)).toHaveLength(2);
    expect(r.html).toContain("Second line<br>third line");
    expect(r.missing).toEqual([]);
  });
  it("turns a paragraph that is only a link into a button, and an inline link into a link", () => {
    const r = renderEmail({ subject: "s", body: "Pay at [here](https://pay.example/x) today.\n\n[Pay now]({{url}})" }, { url: "https://pay.example/abc" }, brand);
    expect(r.html).toContain('<a href="https://pay.example/x" style="color:#2c5e43');
    expect(r.html).toContain("background:#f6b800");
    expect(r.html).toContain('href="https://pay.example/abc"');
    expect(r.text).toContain("here (https://pay.example/x)");
    expect(r.text).toContain("Pay now (https://pay.example/abc)");
  });
  it("escapes everything: variables and template text cannot inject HTML or unsafe links", () => {
    const r = renderEmail({ subject: "s", body: "Hi {{name}} <b>x</b>\n\n[bad](javascript:alert(1))" }, { name: '<script>alert("x")</script>' }, brand);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(r.html).not.toContain('href="javascript');
  });
  it("flattens line breaks in the subject, adds the brand to both versions, and reports missing variables", () => {
    const r = renderEmail({ subject: "Hello\n{{who}}", body: "{{gone}}" }, { who: "Pat" }, brand);
    expect(r.subject).toBe("Hello Pat");
    expect(r.missing).toEqual(["gone"]);
    expect(r.html).toContain("Ironbark Electrical");
    expect(r.html).toContain("(02) 5550 0142");
    expect(r.text.endsWith("Ironbark Electrical\n(02) 5550 0142")).toBe(true);
  });
  it("makes tidy keys", () => {
    expect(slugKey("Quote reminder!")).toBe("quote_reminder");
    expect(slugKey("  --Hi  there--  ")).toBe("hi_there");
  });
});
