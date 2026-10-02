/* eslint-disable @typescript-eslint/no-explicit-any -- step outputs are dynamic JSON in these tests */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runStep, TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { registerIronbark } from "../src/steps/register";
import { addSite, createClient } from "../src/domain/clients";
import { getRequest } from "../src/domain/requests";
import { createQuote, markQuoteSent, replaceQuoteLines, decideQuote } from "../src/domain/quotes";
import { changeJobStatus, scheduleJob } from "../src/domain/jobs";
import { createInvoiceFromJob, getInvoice, issueInvoice, recordPayment } from "../src/domain/invoicing";
import { listClientTimeline } from "../src/domain/activity";
import { ironSparkMockAgent } from "../src/steps/fixtures";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";
import type { Actor } from "../src/domain/shared/actor";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const ref = (path: string) => ({ $ref: path });
const run = (key: string, params: Record<string, unknown>, context: Record<string, unknown> = {}) => runStep(key, { params }, context) as Promise<Record<string, any>>;
const testMode = { [TEST_MODE_CONTEXT_KEY]: true };

beforeAll(() => {
  registerIronbark();
  process.env.EMAIL_ALLOWLIST = "*";
});
afterAll(() => {
  delete process.env.EMAIL_ALLOWLIST;
});
beforeEach(truncateAll);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await appDb.$disconnect();
});

async function client(name = "Pat Smith", email = "pat@example.com", phone?: string) {
  const c = await createClient({ type: "PERSON", name, email, phone, preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(c.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  return { c, site };
}

async function sentQuote(lines = [{ unitPriceCents: 200000 }]) {
  const { c, site } = await client();
  const q = await createQuote({ clientId: c.id, siteId: site.id, title: "Switchboard upgrade" }, priya);
  await replaceQuoteLines(q.id, lines.map((l, i) => ({ description: `Work ${i + 1}`, quantity: 1, unitPriceCents: l.unitPriceCents })), priya);
  await markQuoteSent(q.id, priya);
  return { c, site, quoteId: q.id };
}

async function issuedInvoice() {
  const { c, site, quoteId } = await sentQuote([{ unitPriceCents: 100000 }]);
  const { job } = await decideQuote(quoteId, "APPROVED", undefined, priya);
  await scheduleJob(job!.id, { assignedUserId: "u_jordan", start: sydneyLocalToDate("2026-10-05T09:00")!, end: sydneyLocalToDate("2026-10-05T12:00")! }, priya, "Jordan");
  await changeJobStatus(job!.id, "IN_PROGRESS", priya);
  await changeJobStatus(job!.id, "COMPLETED", priya);
  const inv = await createInvoiceFromJob(job!.id, priya);
  await issueInvoice(inv.id, priya);
  return { c, site, invoiceId: inv.id };
}

describe("findClient", () => {
  it("finds a client by email in any case, or by phone in any format", async () => {
    const { c } = await client("Pat Smith", "Pat@Example.com", "0412 345 678");
    expect(await run("findClient", { email: "PAT@example.COM" })).toEqual({ found: true, clientId: c.id, name: "Pat Smith" });
    expect((await run("findClient", { phone: "+61 412 345 678" })).clientId).toBe(c.id);
    expect(await run("findClient", { email: "nobody@example.com" })).toEqual({ found: false, clientId: null, name: null });
  });
  it("resolves values from earlier steps", async () => {
    const { c } = await client();
    const out = await run("findClient", { email: ref("trigger.from") }, { trigger: { from: "pat@example.com" } });
    expect(out.clientId).toBe(c.id);
  });
});

describe("createEnquiry", () => {
  const params = { from: ref("trigger.from"), summary: "Lights flickering", description: "Lounge room lights flicker at night", category: "FAULT_REPAIR", urgency: "URGENT", contactName: "Pat", contactPhone: "", messageId: "msg_1" };
  const trigger = (from: string) => ({ trigger: { from } });

  it("logs a new enquiry from an unknown sender, unlinked, with the contact details from the email", async () => {
    const out = await run("createEnquiry", params, trigger("Lee Wong <lee@example.org>"));
    expect(out).toMatchObject({ linked: false, clientId: null, isEmergency: false, simulated: false });
    const r = await getRequest(out.requestId);
    expect(r).toMatchObject({ source: "EMAIL", urgency: "URGENT", category: "FAULT_REPAIR", contactEmail: "lee@example.org", rawEmailRef: "msg_1", status: "NEW" });
  });
  it("links the enquiry to the client when exactly one matches the sender", async () => {
    const { c } = await client();
    const out = await run("createEnquiry", params, trigger("Pat Smith <PAT@example.com>"));
    expect(out).toMatchObject({ linked: true, clientId: c.id });
    expect((await getRequest(out.requestId))?.clientId).toBe(c.id);
    expect((await listClientTimeline(c.id)).some((e) => e.actorType === "WORKFLOW" && e.actorLabel === "Enquiry to reply")).toBe(true);
  });
  it("does not guess when two clients match", async () => {
    await client("Pat One", "shared@example.com");
    await client("Pat Two", "shared@example.com");
    expect((await run("createEnquiry", params, trigger("shared@example.com"))).linked).toBe(false);
  });
  it("flags emergencies, and treats unknown categories and urgencies safely", async () => {
    expect((await run("createEnquiry", { ...params, urgency: "EMERGENCY" }, trigger("a@b.co"))).isEmergency).toBe(true);
    const odd = await run("createEnquiry", { ...params, category: "nonsense", urgency: "whenever" }, trigger("a@b.co"));
    expect(await getRequest(odd.requestId)).toMatchObject({ category: "OTHER", urgency: "ROUTINE" });
  });
  it("in a test run it matches the client but writes nothing", async () => {
    const { c } = await client();
    const out = await run("createEnquiry", params, { ...trigger("pat@example.com"), ...testMode });
    expect(out).toMatchObject({ simulated: true, linked: true, clientId: c.id, requestId: "test-request" });
    expect(await appDb.request.count()).toBe(0);
  });
});

describe("getQuote", () => {
  it("gives the quote's facts, an open flag, and ready-to-send wording", async () => {
    const { c, quoteId } = await sentQuote();
    const q = await run("getQuote", { quoteId });
    expect(q).toMatchObject({ clientId: c.id, clientName: "Pat Smith", clientEmail: "pat@example.com", hasEmail: true, status: "SENT", isOpen: true, totalText: "$2,200.00" });
    expect(q.emailSubject).toContain(q.number);
    expect(q.emailBody).toContain("deposit of $660.00"); // over $1,500 -> 30%
    expect(q.reminderBody).toContain("Following up".length ? q.number : "");
  });
  it("is no longer open once the customer has answered", async () => {
    const { quoteId } = await sentQuote();
    await decideQuote(quoteId, "DECLINED", "too dear", priya);
    expect(await run("getQuote", { quoteId })).toMatchObject({ status: "DECLINED", isOpen: false });
  });
  it("reports a missing email so the workflow can hand off to a person, and fails clearly for an unknown quote", async () => {
    const c = await createClient({ type: "PERSON", name: "No Email", preferredContact: "PHONE", tags: [] }, priya);
    const q = await createQuote({ clientId: c.id, title: "T" }, priya);
    await replaceQuoteLines(q.id, [{ description: "x", quantity: 1, unitPriceCents: 1000 }], priya);
    expect(await run("getQuote", { quoteId: q.id })).toMatchObject({ hasEmail: false, clientEmail: "" });
    await expect(run("getQuote", { quoteId: "nope" })).rejects.toThrow(/was not found/);
  });
});

describe("getInvoice", () => {
  it("reports whether it is open or paid, the balance, and all the wording", async () => {
    const { invoiceId } = await issuedInvoice();
    const open = await run("getInvoice", { invoiceId });
    expect(open).toMatchObject({ isOpen: true, isPaid: false, balanceText: "$1,100.00", hasEmail: true, daysOverdue: 0 });
    expect(open.replyQuery).toBe("from:pat@example.com newer_than:7d");
    for (const k of ["invoiceSubject", "reminderSubject", "noticeSubject", "reviewSubject", "reviewReminderSubject"]) expect(open[k], k).toBeTruthy();
    await recordPayment(invoiceId, { amountCents: 110000, method: "BANK" }, priya);
    expect(await run("getInvoice", { invoiceId })).toMatchObject({ isOpen: false, isPaid: true, balanceText: "$0.00" });
  });
  it("counts days overdue for the formal notice wording", async () => {
    const { invoiceId } = await issuedInvoice();
    await appDb.invoice.update({ where: { id: invoiceId }, data: { dueAt: new Date(Date.now() - 15 * 86_400_000) } });
    const out = await run("getInvoice", { invoiceId });
    expect(out.daysOverdue).toBe(15);
    expect(out.noticeBody).toContain("15 days overdue");
  });
});

describe("createPaymentLink", () => {
  const stubStripe = () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { method: string; body: string }) => {
      if (init.method === "GET") {
        calls.push(`GET ${url}`);
        return { ok: true, status: 200, json: async () => ({ id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9", status: "open", amount_total: 110000 }), text: async () => "" };
      }
      calls.push(`${url} ${new URLSearchParams(init.body).get("line_items[0][price_data][unit_amount]")}`);
      return { ok: true, status: 200, json: async () => ({ id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9" }), text: async () => "" };
    });
    return calls;
  };
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("does nothing, and says so, when no payment provider is set up", async () => {
    const { invoiceId } = await issuedInvoice();
    expect(await run("createPaymentLink", { invoiceId })).toEqual({ created: false, payUrl: "", provider: "none" });
  });
  it("creates a link for the balance, saves it on the invoice, and reuses it next time", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const calls = stubStripe();
    const { invoiceId } = await issuedInvoice();
    const first = await run("createPaymentLink", { invoiceId });
    expect(first).toEqual({ created: true, payUrl: "https://checkout.stripe.com/c/pay/cs_test_9", provider: "stripe" });
    expect(calls).toEqual(["https://api.stripe.com/v1/checkout/sessions 110000"]);
    expect((await getInvoice(invoiceId))?.payUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_9");
    expect((await run("createPaymentLink", { invoiceId })).payUrl).toBe(first.payUrl);
    expect(calls.filter((c) => c.includes("sessions 110000"))).toHaveLength(1); // a still-open link for the same amount is reused, not recreated
  });
  it("does not offer a link for a draft or a paid invoice", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const calls = stubStripe();
    const { invoiceId } = await issuedInvoice();
    await recordPayment(invoiceId, { amountCents: 110000, method: "BANK" }, priya);
    expect((await run("createPaymentLink", { invoiceId })).created).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("in a test run it returns a fake link and calls nothing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const calls = stubStripe();
    const { invoiceId } = await issuedInvoice();
    const out = await run("createPaymentLink", { invoiceId }, testMode);
    expect(out).toMatchObject({ created: true, provider: "test" });
    expect(calls).toHaveLength(0);
    expect((await getInvoice(invoiceId))?.payUrl).toBeNull();
  });
});

describe("the recipient allowlist in the steps", () => {
  afterEach(() => {
    process.env.EMAIL_ALLOWLIST = "*";
  });
  it("a client whose address is not allowed reads as having no email, so the workflow hands off to a person", async () => {
    const { quoteId } = await sentQuote();
    process.env.EMAIL_ALLOWLIST = "someone-else@example.org";
    expect(await run("getQuote", { quoteId })).toMatchObject({ hasEmail: false, clientEmail: "" });
    process.env.EMAIL_ALLOWLIST = "@example.com";
    expect(await run("getQuote", { quoteId })).toMatchObject({ hasEmail: true, clientEmail: "pat@example.com" });
    delete process.env.EMAIL_ALLOWLIST; // deny by default
    expect((await run("getQuote", { quoteId })).hasEmail).toBe(false);
  });
  it("same for invoices, including the reply-search query", async () => {
    const { invoiceId } = await issuedInvoice();
    process.env.EMAIL_ALLOWLIST = "nobody@example.org";
    expect(await run("getInvoice", { invoiceId })).toMatchObject({ hasEmail: false, clientEmail: "", replyQuery: "" });
  });
  it("an enquiry from a sender who is not allowed is still logged, but the workflow is told not to write back", async () => {
    const params = { from: ref("trigger.from"), summary: "Lights", category: "FAULT_REPAIR", urgency: "ROUTINE" };
    process.env.EMAIL_ALLOWLIST = "friend@example.org";
    const stranger = await run("createEnquiry", params, { trigger: { from: "Spammer <spam@evil.example>" } });
    expect(stranger.canEmail).toBe(false);
    expect(await getRequest(stranger.requestId)).toBeTruthy();
    expect((await run("createEnquiry", params, { trigger: { from: "Friend <FRIEND@example.org>" } })).canEmail).toBe(true);
  });
});

describe("addTimelineNote", () => {
  it("adds the automation's note to the client's history, attributed to the workflow", async () => {
    const { c } = await client();
    expect(await run("addTimelineNote", { clientId: c.id, summary: "Quote emailed", workflow: "Quote and chase" })).toEqual({ recorded: true });
    const e = (await listClientTimeline(c.id)).find((x) => x.kind === "AUTOMATION");
    expect(e).toMatchObject({ kind: "AUTOMATION", actorType: "WORKFLOW", actorLabel: "Quote and chase", summary: "Quote emailed" });
  });
  it("does nothing in a test run or without a client", async () => {
    const { c } = await client();
    expect(await run("addTimelineNote", { clientId: c.id, summary: "x" }, testMode)).toEqual({ recorded: false });
    expect(await run("addTimelineNote", { clientId: "", summary: "x" })).toEqual({ recorded: false });
    expect((await listClientTimeline(c.id)).filter((e) => e.kind === "AUTOMATION")).toHaveLength(0);
  });
});

describe("AI stand-ins for test runs", () => {
  it("sorts a real enquiry from noise, with urgency, category and a phone number", () => {
    const a = ironSparkMockAgent("triageEnquiry", { from: "Pat Smith <pat@example.com>", subject: "Quote for 6 downlights", body: "Hi, could you quote on installing 6 downlights in our lounge? Call me on 0412 345 678" }) as Record<string, any>;
    expect(a).toMatchObject({ isEnquiry: true, category: "QUOTE_REQUEST", urgency: "ROUTINE", contactName: "Pat Smith", contactPhone: "0412 345 678" });
    expect(a.ackBody).toContain("Hi Pat");
    expect(a.replyDraft).toContain("quote");
    expect((ironSparkMockAgent("triageEnquiry", { from: "x@y.com", subject: "50% off SEO services!", body: "unsubscribe here" }) as Record<string, any>).isEnquiry).toBe(false);
  });
  it("treats a safety risk as an emergency and tells the customer to switch off and call", () => {
    const a = ironSparkMockAgent("triageEnquiry", { from: "a@b.com", subject: "Burning smell from switchboard", body: "There is a burning smell and I heard sparks" }) as Record<string, any>;
    expect(a).toMatchObject({ urgency: "EMERGENCY", category: "FAULT_REPAIR" });
    expect(a.ackBody).toContain("main switch");
    expect(a.ackBody).toContain("(02) 5550 0142");
  });
  it("reads unhappy replies as negative", () => {
    expect((ironSparkMockAgent("classifyFeedback", { body: "Not happy - they left a mess and were late" }) as Record<string, any>).isNegative).toBe(true);
    expect((ironSparkMockAgent("classifyFeedback", { body: "Great job, thanks!" }) as Record<string, any>).isNegative).toBe(false);
    expect(() => ironSparkMockAgent("nope", {})).toThrow(/no mock agent fixture/);
  });
});
