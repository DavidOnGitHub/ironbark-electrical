import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { createClient } from "../src/domain/clients";
import { createRequest, getRequest } from "../src/domain/requests";
import { acceptUrlFor, answerQuoteByToken, createQuote, ensureAcceptToken, getQuote, getQuoteByToken, markQuoteSent, QuoteDecisionError, replaceQuoteLines } from "../src/domain/quotes";
import { listClientTimeline } from "../src/domain/activity";
import { DEFAULT_TEMPLATES, ensureDefaultTemplates, getTemplateByKey, LEGACY_QUOTE_TEMPLATES, renderTemplate } from "../src/domain/emailTemplates";
import type { Actor } from "../src/domain/shared/actor";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };

beforeEach(truncateAll);
afterAll(() => appDb.$disconnect());

async function quote(send = true) {
  const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const request = await createRequest({ summary: "Downlights", category: "NEW_INSTALL", clientId: client.id }, priya);
  const q = await createQuote({ clientId: client.id, requestId: request.id, title: "Downlights" }, priya);
  await replaceQuoteLines(q.id, [{ description: "Downlight", quantity: 6, unitPriceCents: 9000 }], priya);
  if (send) await markQuoteSent(q.id, priya);
  return { client, request, quoteId: q.id };
}

describe("the accept link token", () => {
  it("is created for a sent quote, stays the same, and a draft has none", async () => {
    const draft = await quote(false);
    expect(await ensureAcceptToken(draft.quoteId)).toBeNull();
    const { quoteId } = await quote();
    const t = (await ensureAcceptToken(quoteId))!;
    expect(t.length).toBeGreaterThanOrEqual(30);
    expect(await ensureAcceptToken(quoteId)).toBe(t);
    expect((await Promise.all([ensureAcceptToken(quoteId), ensureAcceptToken(quoteId)])).every((x) => x === t)).toBe(true);
  });
  it("builds the public address from APP_BASE_URL", () => {
    expect(acceptUrlFor("abc", { APP_BASE_URL: "https://ironbark.example/" })).toBe("https://ironbark.example/accept/abc");
    expect(acceptUrlFor("abc", {})).toBe("http://localhost:3200/accept/abc");
  });
  it("finds only its own quote; unknown, short and draft tokens find nothing", async () => {
    const { quoteId } = await quote();
    const t = (await ensureAcceptToken(quoteId))!;
    expect((await getQuoteByToken(t))?.id).toBe(quoteId);
    expect(await getQuoteByToken("nope")).toBeNull();
    expect(await getQuoteByToken("x".repeat(32))).toBeNull();
    await appDb.quote.update({ where: { id: quoteId }, data: { status: "DRAFT" } });
    expect(await getQuoteByToken(t)).toBeNull();
  });
});

describe("answering from the link", () => {
  it("accepting approves the quote, creates the job, wins the enquiry and lands on the timeline", async () => {
    const { client, request, quoteId } = await quote();
    const t = (await ensureAcceptToken(quoteId))!;
    const { job } = await answerQuoteByToken(t, "APPROVED");
    expect(job).toBeTruthy();
    expect((await getQuote(quoteId))!.status).toBe("APPROVED");
    expect((await getRequest(request.id))!.status).toBe("WON");
    const events = await listClientTimeline(client.id);
    expect(events.some((e) => e.summary.includes("approved by the customer") && e.actorLabel === "Customer (accept link)")).toBe(true);
  });
  it("declining records the reason and creates no job", async () => {
    const { quoteId } = await quote();
    const t = (await ensureAcceptToken(quoteId))!;
    const { job } = await answerQuoteByToken(t, "DECLINED", "  too dear  ");
    expect(job).toBeNull();
    const q = (await getQuote(quoteId))!;
    expect(q.status).toBe("DECLINED");
    expect(q.decisionNote).toBe("Declined using the link in the quote email: too dear");
  });
  it("cannot answer twice, after expiry, or with a bad token", async () => {
    const { quoteId } = await quote();
    const t = (await ensureAcceptToken(quoteId))!;
    await answerQuoteByToken(t, "APPROVED");
    await expect(answerQuoteByToken(t, "DECLINED")).rejects.toBeInstanceOf(QuoteDecisionError);
    await expect(answerQuoteByToken("nope", "APPROVED")).rejects.toThrow(/not valid/);
    const other = await quote();
    const t2 = (await ensureAcceptToken(other.quoteId))!;
    await appDb.quote.update({ where: { id: other.quoteId }, data: { validUntil: new Date(Date.now() - 86_400_000) } });
    await expect(answerQuoteByToken(t2, "APPROVED")).rejects.toThrow(/expired/);
  });
});

describe("the quote email templates", () => {
  it("the defaults carry the accept link", async () => {
    await ensureDefaultTemplates();
    for (const key of ["quote_send", "quote_reminder"]) {
      const out = await renderTemplate(key, { clientFirstName: "Pat", title: "T", number: "Q-1", lines: "-", totalText: "$1", depositNote: "", validUntil: "1/1/2027", acceptUrl: "https://x.test/accept/abc" });
      expect(out.html, key).toContain("https://x.test/accept/abc");
    }
  });
  it("moves an untouched earlier default to the new wording but leaves an edited one alone", async () => {
    await ensureDefaultTemplates();
    const send = (await getTemplateByKey("quote_send"))!;
    const reminder = (await getTemplateByKey("quote_reminder"))!;
    await appDb.emailTemplate.update({ where: { id: send.id }, data: LEGACY_QUOTE_TEMPLATES.quote_send![0]! });
    await appDb.emailTemplate.update({ where: { id: reminder.id }, data: { body: "My own words {{number}}" } });
    await ensureDefaultTemplates();
    expect((await getTemplateByKey("quote_send"))!.body).toBe(DEFAULT_TEMPLATES.find((d) => d.key === "quote_send")!.body);
    expect((await getTemplateByKey("quote_send"))!.variables).toContain("acceptUrl");
    expect((await getTemplateByKey("quote_reminder"))!.body).toBe("My own words {{number}}");
  });
});
