/**
 * Stripe, by plain HTTP (no SDK): a Checkout Session for an invoice's balance, and
 * webhook signature verification. Test mode vs live mode is just which key is used.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutRequest {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  customerEmail?: string;
  baseUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export async function createCheckoutSession(req: CheckoutRequest, secretKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: `${req.baseUrl}/pay/thanks?invoice=${encodeURIComponent(req.invoiceNumber)}`,
    cancel_url: `${req.baseUrl}/pay/cancelled?invoice=${encodeURIComponent(req.invoiceNumber)}`,
    client_reference_id: req.invoiceId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "aud",
    "line_items[0][price_data][unit_amount]": String(req.amountCents),
    "line_items[0][price_data][product_data][name]": `Ironbark Electrical - invoice ${req.invoiceNumber}`,
    "metadata[invoiceId]": req.invoiceId,
    "metadata[invoiceNumber]": req.invoiceNumber,
    "payment_intent_data[metadata][invoiceId]": req.invoiceId,
  });
  if (req.customerEmail) body.set("customer_email", req.customerEmail);
  const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Stripe refused the payment link (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url) throw new Error("Stripe did not return a payment link.");
  return { id: json.id, url: json.url };
}

export interface RetrievedSession {
  id: string;
  url: string | null;
  /** "open" (payable), "complete" or "expired". */
  status: string;
  amountTotal: number | null;
}

/** Looks a Checkout Session up, to see whether its link can still be used. */
export async function getCheckoutSession(id: string, secretKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<RetrievedSession> {
  const res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, { method: "GET", headers: { Authorization: `Bearer ${secretKey}` }, body: "" });
  if (!res.ok) throw new Error(`Stripe could not find the payment link (${res.status}).`);
  const json = (await res.json()) as { id?: string; url?: string | null; status?: string; amount_total?: number | null };
  return { id: json.id ?? id, url: json.url ?? null, status: json.status ?? "unknown", amountTotal: json.amount_total ?? null };
}

const TOLERANCE_SECONDS = 300;

/** Verifies a Stripe-Signature header (t=...,v1=...) over the raw body. Constant-time compare; 5-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return signatures.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

export function signStripePayload(payload: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}
