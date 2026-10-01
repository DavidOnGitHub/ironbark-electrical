import { describe, expect, it } from "vitest";
import { formalNotice, invoiceEmail, invoiceReminder, quoteEmail, quoteReminder, reviewRequest } from "../src/steps/messages";

const quote = { clientName: "Pat Smith", number: "Q-1042", title: "Install 6 downlights", totalCents: 165_000, depositCents: 49_500, validUntil: new Date("2026-10-20T00:00:00Z"), lines: [{ description: "LED downlight", quantity: 6, unit: "each", lineTotalCents: 9000 }] };
const inv = { clientName: "Pat Smith", number: "INV-3012", title: "Install 6 downlights", balanceCents: 115_500, totalCents: 165_000, dueAt: new Date("2026-10-12T00:00:00Z"), payUrl: "https://pay.example/abc", daysOverdue: 15 };

describe("email wording", () => {
  it("quote: names the quote, lists lines, shows the total and the deposit, and says how to accept", () => {
    const m = quoteEmail(quote);
    expect(m.subject).toContain("Q-1042");
    expect(m.body).toContain("Hi Pat,");
    expect(m.body).toContain("LED downlight (6 each)");
    expect(m.body).toContain("$1,650.00");
    expect(m.body).toContain("deposit of $495.00");
    expect(m.body).toContain("reply to this email");
  });
  it("quote: no deposit paragraph when none is needed", () => {
    expect(quoteEmail({ ...quote, depositCents: 0 }).body).not.toContain("deposit");
  });
  it("quote reminder: references the quote and the total", () => {
    const m = quoteReminder(quote);
    expect(m.subject).toContain("Q-1042");
    expect(m.body).toContain("$1,650.00");
  });
  it("invoice: amount due, due date, and the pay link when there is one", () => {
    const m = invoiceEmail(inv);
    expect(m.subject).toContain("$1,155.00");
    expect(m.body).toContain("https://pay.example/abc");
    expect(m.body).toContain("Due by:");
    expect(invoiceEmail({ ...inv, payUrl: "" }).body).not.toContain("https://");
    expect(invoiceEmail({ ...inv, payUrl: "" }).body).toContain("bank transfer");
  });
  it("reminder is friendly; the formal notice states the days overdue and a 7-day deadline", () => {
    expect(invoiceReminder(inv).body).toContain("quick reminder");
    const n = formalNotice(inv);
    expect(n.subject).toContain("Overdue");
    expect(n.body).toContain("15 days overdue");
    expect(n.body).toContain("within 7 days");
  });
  it("review request: link, and a different subject for the reminder", () => {
    const a = reviewRequest("Pat Smith", "Downlights", "https://g.page/r/x/review");
    const b = reviewRequest("Pat Smith", "Downlights", "https://g.page/r/x/review", true);
    expect(a.body).toContain("https://g.page/r/x/review");
    expect(a.subject).not.toBe(b.subject);
    expect(b.body).toContain("gentle nudge");
  });
  it("uses a sensible greeting when the name is blank", () => {
    expect(quoteEmail({ ...quote, clientName: "  " }).body).toContain("Hi there,");
  });
});
