/** What a verified Stripe event does to the business: a paid Checkout Session records the payment on its invoice. */
import { appDb } from "../db/app";
import { recordPayment } from "../domain/invoicing";
import { afterInvoicePaid } from "../automation";

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface HandleResult {
  handled: boolean;
  detail: string;
}

const STRIPE_ACTOR = { type: "SYSTEM" as const, label: "Stripe" };

export async function handleStripeEvent(event: StripeEvent): Promise<HandleResult> {
  if (event.type !== "checkout.session.completed") return { handled: false, detail: `ignored ${event.type}` };
  const session = event.data.object as { id?: string; payment_status?: string; amount_total?: number; payment_intent?: string | null; metadata?: { invoiceId?: string } };
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return { handled: false, detail: "session has no invoice reference" };
  if (session.payment_status !== "paid") return { handled: false, detail: `session not paid (${session.payment_status})` };
  if (typeof session.amount_total !== "number" || session.amount_total <= 0) return { handled: false, detail: "session has no amount" };

  const providerId = session.payment_intent || session.id || event.id;
  // Stripe retries webhooks: the same payment must only ever be recorded once.
  const existing = await appDb.payment.findFirst({ where: { stripePaymentId: providerId }, select: { id: true } });
  if (existing) return { handled: true, detail: "already recorded" };

  try {
    const invoice = await recordPayment(invoiceId, { amountCents: session.amount_total, method: "STRIPE", reference: `Stripe ${session.id ?? ""}`.trim(), stripePaymentId: providerId }, STRIPE_ACTOR);
    if (invoice.status === "PAID") await afterInvoicePaid(invoiceId);
    return { handled: true, detail: `recorded on ${invoice.number}` };
  } catch (err) {
    // e.g. the invoice was already paid another way. Answer 200 (a retry cannot fix it) and leave it visible in the logs.
    console.error(`[stripe] could not record payment for invoice ${invoiceId}:`, err instanceof Error ? err.message : err);
    return { handled: false, detail: err instanceof Error ? err.message : "could not record payment" };
  }
}
