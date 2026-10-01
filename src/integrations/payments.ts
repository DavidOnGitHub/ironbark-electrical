/**
 * The invoice's card payment link. A Stripe Checkout link lasts 24 hours at most, but an invoice has
 * 7-day terms and gets reminders for weeks - so a stored link is only reused if Stripe says it is still
 * open AND for exactly what is still owing; otherwise a fresh one replaces it.
 */
import { getInvoice, setPaymentLink } from "../domain/invoicing";
import type { Actor } from "../domain/shared/actor";
import { createCheckoutSession, getCheckoutSession, type FetchLike } from "./stripe";

export interface PaymentLinkResult {
  created: boolean;
  payUrl: string;
  provider: "stripe" | "none";
  /** True when an existing link was still good and kept. */
  reused?: boolean;
}

export function stripeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

export async function ensurePaymentLink(
  invoiceId: string,
  actor: Actor,
  deps: { secretKey?: string; baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<PaymentLinkResult> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} was not found.`);
  if ((invoice.status !== "SENT" && invoice.status !== "PARTIALLY_PAID") || invoice.balanceCents <= 0) return { created: false, payUrl: "", provider: "none" };
  const key = deps.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key) return { created: false, payUrl: "", provider: "none" };

  if (invoice.payUrl && invoice.stripeInvoiceId) {
    try {
      const existing = await getCheckoutSession(invoice.stripeInvoiceId, key, deps.fetchImpl);
      if (existing.status === "open" && existing.amountTotal === invoice.balanceCents) return { created: true, payUrl: invoice.payUrl, provider: "stripe", reused: true };
    } catch {
      // Cannot tell - make a fresh one rather than hand out a link that may be dead.
    }
  }
  const session = await createCheckoutSession(
    { invoiceId, invoiceNumber: invoice.number, amountCents: invoice.balanceCents, customerEmail: invoice.client.email ?? undefined, baseUrl: deps.baseUrl ?? (process.env.APP_BASE_URL || "http://localhost:3000") },
    key,
    deps.fetchImpl,
  );
  await setPaymentLink(invoiceId, { payUrl: session.url, providerRef: session.id }, actor);
  return { created: true, payUrl: session.url, provider: "stripe", reused: false };
}
