import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createPriceItem } from "../src/domain/pricing";
import { createRequest } from "../src/domain/requests";
import { createQuote, getQuote, linesFromSuggestions, replaceQuoteLines, type Suggestion } from "../src/domain/quotes";
import { bookSiteVisit, completeSiteVisit } from "../src/domain/siteVisits";
import { reviewForTask } from "../src/domain/approvals";
import { draftQuoteImpl, sendQuoteImpl } from "../src/steps/impl";
import { visitToQuote } from "../src/workflows";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const testMode = { [TEST_MODE_CONTEXT_KEY]: true } as never;
let savedKey: string | undefined;
let savedAutomations: string | undefined;

beforeAll(() => {
  // Never call the real AI, and never start a real follow-up run from a test.
  savedKey = process.env.ANTHROPIC_API_KEY;
  savedAutomations = process.env.AUTOMATIONS;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AUTOMATIONS = "off";
});
beforeEach(truncateAll);
afterAll(async () => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedAutomations === undefined) delete process.env.AUTOMATIONS;
  else process.env.AUTOMATIONS = savedAutomations;
  await appDb.$disconnect();
});

async function finishedVisit(opts: { findings?: string; description?: string; summary?: string; linked?: boolean } = {}) {
  const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const request = await createRequest({ summary: opts.summary ?? "Install downlights in the lounge", description: opts.description ?? "Could you quote on new downlights?", category: "QUOTE_REQUEST", ...(opts.linked === false ? {} : { clientId: client.id, siteId: site.id }) }, priya);
  const visit = await bookSiteVisit(request.id, { assignedUserId: "u_jordan", start: sydneyLocalToDate("2026-10-20T09:00")!, end: sydneyLocalToDate("2026-10-20T10:00")! }, priya, "Jordan Lee").catch(async () => {
    // an unlinked enquiry cannot be booked by the office; book it through the table for the test
    return appDb.siteVisit.create({ data: { requestId: request.id, assignedUserId: "u_jordan", scheduledStart: sydneyLocalToDate("2026-10-20T09:00")!, scheduledEnd: sydneyLocalToDate("2026-10-20T10:00")! } });
  });
  await completeSiteVisit(visit.id, opts.findings ?? "Ceiling is accessible. Six downlights needed in the lounge room.", priya);
  return { client, request, visit };
}

async function priceList() {
  await createPriceItem({ kind: "STANDARD_JOB", name: "Downlight supply and fit", unit: "each", priceCents: 9000, description: "LED downlight, supplied and installed" }, priya);
  await createPriceItem({ kind: "LABOUR", name: "Electrician", unit: "hour", priceCents: 11000 }, priya);
}

describe("merging suggestions into quote lines", () => {
  it("adds the same price-list entry up rather than repeating it", () => {
    const line = (id: string, quantity: number) => ({ priceItemId: id, description: id, quantity, unit: "each", unitPriceCents: 100 });
    const s = (lines: ReturnType<typeof line>[]): Suggestion => ({ kind: "item", id: "x", name: "x", quantity: 1, reason: "", lines, totalCents: 0 });
    const out = linesFromSuggestions([s([line("a", 2), line("b", 1)]), s([line("a", 3)])]);
    expect(out.map((l) => [l.priceItemId, l.quantity])).toEqual([["a", 5], ["b", 1]]);
  });
});

describe("drafting a quote from a site visit", () => {
  it("builds a draft from the price list, with the electrician's findings in the notes", async () => {
    await priceList();
    const { request, visit } = await finishedVisit();
    const out = (await draftQuoteImpl({ params: { visitId: visit.id } }, {} as never)) as { created: boolean; quoteId: string; lineCount: number; source: string };
    expect(out).toMatchObject({ created: true, source: "keywords" });
    expect(out.lineCount).toBeGreaterThan(0);
    const quote = (await getQuote(out.quoteId))!;
    expect(quote.status).toBe("DRAFT");
    expect(quote.requestId).toBe(request.id);
    expect(quote.notes).toContain("Based on our site inspection: Ceiling is accessible");
    expect(quote.lines.every((l) => l.priceItemId)).toBe(true); // only price-list entries
    expect(quote.totalCents).toBeGreaterThan(0);
  });
  it("still drafts when nothing matches, and says the lines must be added by hand", async () => {
    await priceList();
    const { visit } = await finishedVisit({ findings: "Needs a quirky bespoke thing", description: "Something unusual", summary: "Odd request" });
    const out = (await draftQuoteImpl({ params: { visitId: visit.id } }, {} as never)) as { created: boolean; lineCount: number; reason: string };
    expect(out).toMatchObject({ created: true, lineCount: 0 });
    expect(out.reason).toMatch(/Add them before sending/);
  });
  it("does not draft a second quote, or one for an enquiry with no client", async () => {
    await priceList();
    const first = await finishedVisit();
    const a = (await draftQuoteImpl({ params: { visitId: first.visit.id } }, {} as never)) as { created: boolean };
    const again = (await draftQuoteImpl({ params: { visitId: first.visit.id } }, {} as never)) as { created: boolean; reason: string };
    expect(a.created).toBe(true);
    expect(again).toMatchObject({ created: false, reason: "This enquiry already has a quote." });
    const orphan = await finishedVisit({ linked: false });
    expect(await draftQuoteImpl({ params: { visitId: orphan.visit.id } }, {} as never)).toMatchObject({ created: false });
  });
  it("changes nothing in a test run", async () => {
    await priceList();
    const { visit } = await finishedVisit();
    expect(await draftQuoteImpl({ params: { visitId: visit.id } }, testMode)).toMatchObject({ created: true, simulated: true });
    expect(await appDb.quote.count()).toBe(0);
  });
});

describe("sending the approved quote", () => {
  async function draft() {
    const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
    const quote = await createQuote({ clientId: client.id, title: "Downlights" }, priya);
    return quote;
  }
  it("sends a quote with priced lines, and only once", async () => {
    const quote = await draft();
    await replaceQuoteLines(quote.id, [{ description: "Downlight", quantity: 6, unit: "each", unitPriceCents: 9000 }], priya);
    const out = (await sendQuoteImpl({ params: { quoteId: quote.id } }, {} as never)) as { sent: boolean; followUpStarted: boolean; reason: string };
    expect(out.sent).toBe(true);
    expect(out.followUpStarted).toBe(false); // automations are off in tests
    expect((await getQuote(quote.id))!.status).toBe("SENT");
    expect(await sendQuoteImpl({ params: { quoteId: quote.id } }, {} as never)).toMatchObject({ sent: false, reason: expect.stringMatching(/already been sent/) });
  });
  it("hands an empty quote back with a reason instead of failing the run", async () => {
    const quote = await draft();
    expect(await sendQuoteImpl({ params: { quoteId: quote.id } }, {} as never)).toMatchObject({ sent: false, reason: expect.stringMatching(/priced line/) });
    expect((await getQuote(quote.id))!.status).toBe("DRAFT");
  });
  it("sends nothing in a test run", async () => {
    const quote = await draft();
    await replaceQuoteLines(quote.id, [{ description: "Downlight", quantity: 1, unit: "each", unitPriceCents: 9000 }], priya);
    expect(await sendQuoteImpl({ params: { quoteId: quote.id } }, testMode)).toMatchObject({ sent: true, simulated: true });
    expect((await getQuote(quote.id))!.status).toBe("DRAFT");
  });
});

describe("what the office approves", () => {
  const task = (quoteId: string) => ({ input: { reviewsNodeId: "send_quote" }, instance: { context: { draft: { quoteId } }, definition: { graph: visitToQuote, publishedGraph: null } } });
  it("shows the draft quote with its lines and totals, ready to open and edit", async () => {
    const quote = await createQuote({ clientId: (await createClient({ type: "PERSON", name: "Pat Smith", preferredContact: "EMAIL", tags: [] }, priya)).id, title: "Downlights" }, priya);
    await replaceQuoteLines(quote.id, [{ description: "Downlight supply and fit", quantity: 6, unit: "each", unitPriceCents: 9000 }], priya);
    const review = await reviewForTask(task(quote.id));
    expect(review).toMatchObject({ kind: "quote", quoteId: quote.id, clientName: "Pat Smith", problem: null });
    expect((review as { lines: unknown[] }).lines).toHaveLength(1);
    expect((review as { totalText: string }).totalText).toBe("$594.00");
  });
  it("warns when there is nothing to send yet", async () => {
    const quote = await createQuote({ clientId: (await createClient({ type: "PERSON", name: "Pat Smith", preferredContact: "EMAIL", tags: [] }, priya)).id, title: "Empty" }, priya);
    expect(await reviewForTask(task(quote.id))).toMatchObject({ kind: "quote", problem: expect.stringMatching(/no priced lines/) });
  });
});
