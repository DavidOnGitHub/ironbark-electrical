import { verifyStripeSignature } from "../../../../src/integrations/stripe";
import { handleStripeEvent, type StripeEvent } from "../../../../src/integrations/stripeEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe calls this when a payment link is paid. Not behind sign-in (Stripe cannot sign in) - the signature is the proof. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return Response.json({ error: "Bad signature." }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ error: "Bad payload." }, { status: 400 });
  }
  const result = await handleStripeEvent(event);
  return Response.json({ received: true, ...result });
}
