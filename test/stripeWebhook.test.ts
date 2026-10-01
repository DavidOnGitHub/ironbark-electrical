import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createQuote, decideQuote, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { changeJobStatus, getJob, scheduleJob } from "../src/domain/jobs";
import { createInvoiceFromJob, getInvoice, issueInvoice } from "../src/domain/invoicing";
import { handleStripeEvent, type StripeEvent } from "../src/integrations/stripeEvents";
import { automationsEnabled, startAutomation, type AutomationDeps } from "../src/automation";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";
import type { Actor } from "../src/domain/shared/actor";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };

beforeEach(truncateAll);
afterAll(async () => {
  await appDb.$disconnect();
});

async function issued(amountCents = 100000) {
  const c = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(c.id, { line1: "1 A St", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const q = await createQuote({ clientId: c.id, siteId: site.id, title: "Job" }, priya);
  await replaceQuoteLines(q.id, [{ description: "Work", quantity: 1, unitPriceCents: amountCents }], priya);
  await markQuoteSent(q.id, priya);
  const { job } = await decideQuote(q.id, "APPROVED", undefined, priya);
  await scheduleJob(job!.id, { assignedUserId: "u_j", start: sydneyLocalToDate("2026-10-05T09:00")!, end: sydneyLocalToDate("2026-10-05T11:00")! }, priya, "J");
  await changeJobStatus(job!.id, "IN_PROGRESS", priya);
  await changeJobStatus(job!.id, "COMPLETED", priya);
  const inv = await createInvoiceFromJob(job!.id, priya);
  await issueInvoice(inv.id, priya);
  return { invoiceId: inv.id, jobId: job!.id };
}

const paid = (invoiceId: string, over: Record<string, unknown> = {}): StripeEvent => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 110000, payment_intent: "pi_1", metadata: { invoiceId }, ...over } },
});

describe("Stripe events", () => {
  it("a paid checkout session records the payment, closes the invoice and the job", async () => {
    const { invoiceId, jobId } = await issued();
    const r = await handleStripeEvent(paid(invoiceId));
    expect(r).toMatchObject({ handled: true });
    const inv = await getInvoice(invoiceId);
    expect(inv).toMatchObject({ status: "PAID", balanceCents: 0 });
    expect(inv?.payments).toEqual([expect.objectContaining({ method: "STRIPE", amountCents: 110000, stripePaymentId: "pi_1", kind: "INVOICE" })]);
    expect((await getJob(jobId))?.status).toBe("PAID");
  });
  it("is idempotent: Stripe retrying the same event records the money once", async () => {
    const { invoiceId } = await issued();
    await handleStripeEvent(paid(invoiceId));
    expect(await handleStripeEvent(paid(invoiceId))).toEqual({ handled: true, detail: "already recorded" });
    expect(await appDb.payment.count({ where: { invoiceId, kind: "INVOICE" } })).toBe(1);
  });
  it("ignores events it does not act on, unpaid sessions and sessions with no invoice", async () => {
    const { invoiceId } = await issued();
    expect((await handleStripeEvent({ id: "e", type: "charge.refunded", data: { object: {} } })).handled).toBe(false);
    expect((await handleStripeEvent(paid(invoiceId, { payment_status: "unpaid" }))).detail).toMatch(/not paid/);
    expect((await handleStripeEvent(paid(invoiceId, { metadata: {} }))).detail).toMatch(/no invoice reference/);
    expect((await handleStripeEvent(paid(invoiceId, { amount_total: 0 }))).detail).toMatch(/no amount/);
    expect((await getInvoice(invoiceId))?.status).toBe("SENT");
  });
  it("a payment larger than what is owing is refused, not recorded, and does not throw", async () => {
    const { invoiceId } = await issued();
    const r = await handleStripeEvent(paid(invoiceId, { amount_total: 999999 }));
    expect(r.handled).toBe(false);
    expect(r.detail).toMatch(/more than the/);
    expect((await getInvoice(invoiceId))?.payments).toEqual([]);
  });
  it("a part payment leaves the invoice part paid", async () => {
    const { invoiceId } = await issued();
    await handleStripeEvent(paid(invoiceId, { amount_total: 40000, payment_intent: "pi_part" }));
    expect(await getInvoice(invoiceId)).toMatchObject({ status: "PARTIALLY_PAID", balanceCents: 70000 });
  });
});

describe("starting an automation", () => {
  const published = (id: string) => ({ id, status: "PUBLISHED", publishedVersion: 3, publishedGraph: { id, name: "t", version: 3, status: "PUBLISHED", nodes: [{ id: "trigger", type: "TRIGGER", stepKey: "manual", config: {}, position: { x: 0, y: 0 } }], edges: [] } });
  const noStart = (async () => {
    throw new Error("must not start");
  }) as unknown as AutomationDeps["start"];

  it("starts a PUBLISHED workflow in production mode with the trigger as its context", async () => {
    let seen: Parameters<AutomationDeps["start"]>[0] | null = null;
    const r = await startAutomation("quoteChase", { quoteId: "q_1" }, {
      loadDefinition: async (id) => published(id),
      start: (async (params: Parameters<AutomationDeps["start"]>[0]) => {
        seen = params;
        return { instanceId: "inst_1" };
      }) as AutomationDeps["start"],
    });
    expect(r).toEqual({ started: true, instanceId: "inst_1" });
    expect(seen).toMatchObject({ definitionId: "def_ironspark_quote_chase", mode: "PRODUCTION", initialContext: { quoteId: "q_1" }, graphVersion: 3, graphStatus: "PUBLISHED" });
  });
  it("does not start one that is not set up, or only a draft", async () => {
    expect(await startAutomation("quoteChase", {}, { loadDefinition: async () => null, start: noStart })).toEqual({ started: false, reason: "workflow is not set up yet" });
    expect(await startAutomation("quoteChase", {}, { loadDefinition: async (id) => ({ id, status: "DRAFT", publishedGraph: null, publishedVersion: null }), start: noStart })).toEqual({ started: false, reason: "workflow is not published" });
  });
  it("never throws: a failure to start is reported, not raised", async () => {
    const r = await startAutomation("invoiceChase", { invoiceId: "i" }, { loadDefinition: async (id) => published(id), start: (async () => {
      throw new Error("Temporal is down");
    }) as unknown as AutomationDeps["start"] });
    expect(r).toEqual({ started: false, reason: "Temporal is down" });
    const bad = await startAutomation("invoiceChase", {}, { loadDefinition: async (id) => ({ id, status: "PUBLISHED", publishedGraph: { nonsense: true }, publishedVersion: 1 }), start: noStart });
    expect(bad.started).toBe(false);
  });
  it("uses the right workflow for each business event", async () => {
    const ids: string[] = [];
    const deps: AutomationDeps = { loadDefinition: async (id) => (ids.push(id), null), start: noStart };
    for (const k of ["enquiryToReply", "quoteChase", "invoiceChase", "reviewRequest"] as const) await startAutomation(k, {}, deps);
    expect(ids).toEqual(["def_ironspark_enquiry_to_reply", "def_ironspark_quote_chase", "def_ironspark_invoice_chase", "def_ironspark_review_request"]);
  });
  it("can be switched off completely", async () => {
    expect(automationsEnabled({ AUTOMATIONS: "off" })).toBe(false);
    expect(automationsEnabled({ AUTOMATIONS: "OFF" })).toBe(false);
    expect(automationsEnabled({})).toBe(true);
    process.env.AUTOMATIONS = "off";
    try {
      expect(await startAutomation("invoiceChase", { invoiceId: "i" }, { loadDefinition: async (id) => published(id), start: noStart })).toEqual({ started: false, reason: "automations are switched off" });
    } finally {
      delete process.env.AUTOMATIONS;
    }
  });
});
