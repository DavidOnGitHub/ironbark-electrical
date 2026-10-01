import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";

export const dynamic = "force-dynamic";

/** Where Stripe sends a customer after the payment page. Public: the customer has no account. */
export default async function PayPage(props: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice } = await props.searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Thank you - payment received</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {invoice ? <p className="mb-2 font-medium text-foreground">Invoice {invoice.slice(0, 20)}</p> : null}
          <p>Your payment is being processed and a receipt is on its way to your email. If anything looks wrong, just reply to our invoice email.</p>
          <p className="mt-3">Ironbark Electrical</p>
        </CardContent>
      </Card>
    </div>
  );
}
