import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createQuote, decideQuote, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { changeJobStatus, scheduleJob } from "../src/domain/jobs";
import { createInvoiceFromJob, getInvoice, issueInvoice, recordPayment } from "../src/domain/invoicing";
import { ensurePaymentLink, stripeConfigured } from "../src/integrations/payments";
import { getCheckoutSession, type FetchLike } from "../src/integrations/stripe";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";
import type { Actor } from "../src/domain/shared/actor";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };

beforeEach(truncateAll);
afterAll(async () => {
  await appDb.$disconnect();
});

async function issuedInvoice() {
  const c = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(c.id, { line1: "1 A St", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const q = await createQuote({ clientId: c.id, siteId: site.id, title: "Job" }, priya);
  await replaceQuoteLines(q.id, [{ description: "Work", quantity: 1, unitPriceCents: 100000 }], priya);
  await markQuoteSent(q.id, priya);
  const { job } = await decideQuote(q.id, "APPROVED", undefined, priya);
  await scheduleJob(job!.id, { assignedUserId: "u_j", start: sydneyLocalToDate("2026-10-05T09:00")!, end: sydneyLocalToDate("2026-10-05T11:00")! }, priya, "J");
  await changeJobStatus(job!.id, "IN_PROGRESS", priya);
  await changeJobStatus(job!.id, "COMPLETED", priya);
  const inv = await createInvoiceFromJob(job!.id, priya);
  await issueInvoice(inv.id, priya);
  return inv.id;
}

/** A fake Stripe that remembers the sessions it made and can age or change them. */
function fakeStripe() {
  const sessions = new Map<string, { url: string; status: string; amount: number }>();
  let n = 0;
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    if (init.method === "POST") {
      const form = new URLSearchParams(init.body);
      const id = `cs_${++n}`;
      sessions.set(id, { url: `https://checkout.stripe.com/pay/${id}`, status: "open", amount: Number(form.get("line_items[0][price_data][unit_amount]")) });
      calls.push(`create ${id}`);
      return { ok: true, status: 200, json: async () => ({ id, url: sessions.get(id)!.url }), text: async () => "" };
    }
    const id = decodeURIComponent(url.split("/").pop()!);
    calls.push(`get ${id}`);
    const s = sessions.get(id);
    if (!s) return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
    return { ok: true, status: 200, json: async () => ({ id, url: s.url, status: s.status, amount_total: s.amount }), text: async () => "" };
  };
  return { sessions, calls, fetchImpl };
}

describe("ensurePaymentLink", () => {
  it("creates a link for exactly what is owing and keeps it on the invoice", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    const r = await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    expect(r).toEqual({ created: true, payUrl: "https://checkout.stripe.com/pay/cs_1", provider: "stripe", reused: false });
    expect(stripe.sessions.get("cs_1")?.amount).toBe(110000);
    expect(await getInvoice(id)).toMatchObject({ payUrl: "https://checkout.stripe.com/pay/cs_1", stripeInvoiceId: "cs_1" });
  });

  it("reuses a link that is still open for the same amount", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    const again = await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    expect(again).toMatchObject({ reused: true, payUrl: "https://checkout.stripe.com/pay/cs_1" });
    expect(stripe.sessions.size).toBe(1);
  });

  it("replaces a link that has expired (they last 24 hours; reminders go out for weeks)", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    stripe.sessions.get("cs_1")!.status = "expired";
    const fresh = await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    expect(fresh).toMatchObject({ reused: false, payUrl: "https://checkout.stripe.com/pay/cs_2" });
    expect((await getInvoice(id))?.payUrl).toBe("https://checkout.stripe.com/pay/cs_2");
  });

  it("replaces a link for the wrong amount after a part payment, so the customer pays the new balance", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    await recordPayment(id, { amountCents: 30000, method: "BANK" }, priya);
    const fresh = await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    expect(fresh.reused).toBe(false);
    expect(stripe.sessions.get("cs_2")?.amount).toBe(80000);
  });

  it("makes a fresh link rather than trust one it cannot check", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl });
    stripe.sessions.delete("cs_1"); // Stripe now answers 404 for it
    expect((await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl })).reused).toBe(false);
  });

  it("offers nothing without a Stripe key, for a paid invoice, or for a draft", async () => {
    const id = await issuedInvoice();
    const stripe = fakeStripe();
    expect(await ensurePaymentLink(id, priya, { secretKey: "", fetchImpl: stripe.fetchImpl })).toEqual({ created: false, payUrl: "", provider: "none" });
    await recordPayment(id, { amountCents: 110000, method: "BANK" }, priya);
    expect((await ensurePaymentLink(id, priya, { secretKey: "sk_test", fetchImpl: stripe.fetchImpl })).created).toBe(false);
    expect(stripe.calls).toEqual([]);
    expect(stripeConfigured({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(true);
    expect(stripeConfigured({})).toBe(false);
  });
});

describe("getCheckoutSession", () => {
  it("reads the status and amount, and fails clearly for an unknown session", async () => {
    const stripe = fakeStripe();
    stripe.sessions.set("cs_x", { url: "https://x", status: "complete", amount: 500 });
    expect(await getCheckoutSession("cs_x", "sk", stripe.fetchImpl)).toEqual({ id: "cs_x", url: "https://x", status: "complete", amountTotal: 500 });
    await expect(getCheckoutSession("nope", "sk", stripe.fetchImpl)).rejects.toThrow(/could not find/);
  });
});
