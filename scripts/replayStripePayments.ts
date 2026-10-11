/**
 * Re-delivers recent paid Checkout events from YOUR Stripe account (the one STRIPE_SECRET_KEY belongs to) to the
 * local webhook, for payments that happened while `stripe listen` was not forwarding them. Safe to run twice:
 * a payment already recorded is skipped. Needs `pnpm dev` running with the same STRIPE_WEBHOOK_SECRET as .env.
 * Usage: pnpm payments:replay
 */
import { signStripePayload } from "../src/integrations/stripe";

const key = process.env.STRIPE_SECRET_KEY;
const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!key || !secret) throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in .env.");
const base = (process.env.APP_BASE_URL || "http://localhost:3200").replace(/\/+$/, "");

const res = await fetch("https://api.stripe.com/v1/events?limit=30&types[]=checkout.session.completed", { headers: { Authorization: `Bearer ${key}` } });
const body = (await res.json()) as { data?: { id: string; type: string; data: { object: Record<string, unknown> } }[]; error?: { message: string } };
if (!res.ok || !body.data) throw new Error(`Stripe said: ${body.error?.message ?? res.status}`);

console.log(`${body.data.length} paid checkout event(s) in the last 30 days on this Stripe account.`);
for (const event of body.data.reverse()) {
  const payload = JSON.stringify(event);
  const r = await fetch(`${base}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signStripePayload(payload, secret) }, body: payload });
  const out = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
  const meta = (event.data.object.metadata ?? {}) as { invoiceNumber?: string };
  console.log(`${meta.invoiceNumber ?? event.id}: ${r.status} ${out.detail ?? out.error ?? ""}`);
}
