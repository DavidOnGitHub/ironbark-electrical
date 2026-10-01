import { describe, expect, it } from "vitest";
import { createCheckoutSession, signStripePayload, verifyStripeSignature } from "../src/integrations/stripe";

const SECRET = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const NOW = 1_800_000_000;

describe("Stripe webhook signature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verifyStripeSignature(payload, signStripePayload(payload, SECRET, NOW), SECRET, NOW)).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, a missing or malformed header", () => {
    const header = signStripePayload(payload, SECRET, NOW);
    expect(verifyStripeSignature(payload, header, "whsec_other", NOW)).toBe(false);
    expect(verifyStripeSignature(payload + " ", header, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, "garbage", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${NOW}`, SECRET, NOW)).toBe(false);
  });
  it("rejects a replay outside the 5-minute window, accepts one inside it", () => {
    const header = signStripePayload(payload, SECRET, NOW);
    expect(verifyStripeSignature(payload, header, SECRET, NOW + 301)).toBe(false);
    expect(verifyStripeSignature(payload, header, SECRET, NOW + 299)).toBe(true);
    expect(verifyStripeSignature(payload, header, SECRET, NOW - 301)).toBe(false);
  });
  it("accepts when any one of several v1 signatures matches (key rotation)", () => {
    const good = signStripePayload(payload, SECRET, NOW).split("v1=")[1]!;
    expect(verifyStripeSignature(payload, `t=${NOW},v1=deadbeef,v1=${good}`, SECRET, NOW)).toBe(true);
  });
});

describe("createCheckoutSession", () => {
  const req = { invoiceId: "inv_1", invoiceNumber: "INV-3001", amountCents: 115_500, customerEmail: "pat@example.com", baseUrl: "https://demo.example" };

  it("sends the balance in cents, in AUD, tagged with the invoice, using the secret key", async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string>; body: string } } | null = null;
    const session = await createCheckoutSession(req, "sk_test_123", async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }), text: async () => "" };
    });
    expect(session).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(seen!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.headers.Authorization).toBe("Bearer sk_test_123");
    const form = new URLSearchParams(seen!.init.body);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("115500");
    expect(form.get("line_items[0][price_data][currency]")).toBe("aud");
    expect(form.get("metadata[invoiceId]")).toBe("inv_1");
    expect(form.get("client_reference_id")).toBe("inv_1");
    expect(form.get("customer_email")).toBe("pat@example.com");
    expect(form.get("success_url")).toBe("https://demo.example/pay/thanks?invoice=INV-3001");
  });
  it("omits the customer email when there is none", async () => {
    let body = "";
    await createCheckoutSession({ ...req, customerEmail: undefined }, "sk_test_123", async (_u, init) => {
      body = init.body;
      return { ok: true, status: 200, json: async () => ({ id: "cs", url: "https://x" }), text: async () => "" };
    });
    expect(new URLSearchParams(body).has("customer_email")).toBe(false);
  });
  it("turns a Stripe refusal into a clear error", async () => {
    await expect(createCheckoutSession(req, "sk_test_bad", async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "Invalid API Key" }))).rejects.toThrow(/Stripe refused.*401.*Invalid API Key/);
    await expect(createCheckoutSession(req, "sk", async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }))).rejects.toThrow(/did not return a payment link/);
  });
});
