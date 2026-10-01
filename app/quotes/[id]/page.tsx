import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { getQuote, DEPOSIT_PCT, GST_RATE_PCT } from "../../../src/domain/quotes";
import { listPriceItems } from "../../../src/domain/pricing";
import { listEntityTimeline } from "../../../src/domain/activity";
import { formatSite } from "../../../src/domain/clients";
import { decideQuoteAction, extendQuoteValidityAction, markQuoteSentAction, saveQuoteLinesAction } from "../../../src/actions/quotes";
import { formatMoney } from "../../../src/lib/money";
import { ActionForm } from "../../../src/ui/ActionForm";
import { PageHeader, SelectField, TextAreaField } from "../../../src/ui/fields";
import { QuoteStatusChip } from "../../../src/ui/chips";
import { QuoteEditor } from "../../../src/ui/QuoteEditor";
import { PrintButton } from "../../../src/ui/PrintButton";
import { Timeline } from "../../../src/ui/Timeline";

export const dynamic = "force-dynamic";

export default async function QuotePage(props: { params: Promise<{ id: string }> }) {
  const user = await requireBusinessPage(Access.QUOTES_READ);
  const { id } = await props.params;
  const quote = await getQuote(id);
  if (!quote) notFound();
  const canWrite = hasAnyRole(user.roles, Access.QUOTES_WRITE);
  const [timeline, priceItems] = await Promise.all([listEntityTimeline("quote", id), quote.status === "DRAFT" && canWrite ? listPriceItems({ activeOnly: true }) : Promise.resolve([])]);
  const status = quote.effectiveStatus;
  const editable = quote.status === "DRAFT" && canWrite;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/quotes" className="text-sm text-muted-foreground hover:text-foreground">&larr; Quotes</Link>
      <PageHeader
        title={`${quote.number} - ${quote.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <QuoteStatusChip status={status} />
            <span>
              for <Link className="underline" href={`/clients/${quote.client.id}`}>{quote.client.name}</Link>
              {quote.site ? ` - ${formatSite(quote.site)}` : ""}
            </span>
            {quote.request ? <Link className="underline" href={`/requests/${quote.request.id}`}>enquiry</Link> : null}
            {quote.job ? <Link className="underline" href={`/jobs/${quote.job.id}`}>job {quote.job.number}</Link> : null}
          </span>
        }
        actions={<PrintButton label="Print / save as PDF" />}
      />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {editable ? (
              <QuoteEditor
                quoteId={quote.id}
                action={saveQuoteLinesAction}
                priceItems={priceItems.map((p) => ({ id: p.id, name: p.name, kind: p.kind, unit: p.unit, priceCents: p.priceCents }))}
                initialLines={quote.lines.map((l) => ({ priceItemId: l.priceItemId, description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unitPriceCents }))}
              />
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Description</th>
                        <th className="px-3 py-2 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                        <th className="px-3 py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.lines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="px-3 py-2">{l.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)} {l.unit}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.unitPriceCents)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.lineTotalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" data-testid="totals">
                  <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{formatMoney(quote.subtotalCents)}</dd>
                  <dt className="text-muted-foreground">GST ({GST_RATE_PCT}%)</dt><dd className="text-right tabular-nums">{formatMoney(quote.gstCents)}</dd>
                  <dt className="font-semibold">Total incl GST</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(quote.totalCents)}</dd>
                  {quote.depositRequired ? (<><dt className="text-amber-700 dark:text-amber-400">Deposit ({DEPOSIT_PCT}%)</dt><dd className="text-right tabular-nums text-amber-700 dark:text-amber-400">{formatMoney(quote.depositCents)}</dd></>) : null}
                </dl>
              </>
            )}
            {quote.notes && !editable ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{quote.notes}</p> : null}
            {quote.status !== "DRAFT" ? (
              <p className="text-xs text-muted-foreground">
                {quote.sentAt ? `Sent ${quote.sentAt.toLocaleDateString("en-AU")}. ` : ""}Valid until {quote.validUntil.toLocaleDateString("en-AU")}.
                {quote.decidedAt ? ` Decided ${quote.decidedAt.toLocaleDateString("en-AU")}${quote.decisionNote ? `: ${quote.decisionNote}` : ""}.` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          {canWrite && status === "DRAFT" ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Send</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">Check the lines and totals, then mark it as sent. That starts the {14}-day validity and moves the enquiry to Quoted. Emailing the quote to the customer arrives with the quote-and-chase workflow.</p>
                <ActionForm action={markQuoteSentAction} submitLabel="Mark as sent" successMessage="Marked as sent.">
                  <input type="hidden" name="quoteId" value={quote.id} />
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
          {canWrite && (status === "SENT" || status === "EXPIRED") ? (
            <Card>
              <CardHeader><CardTitle className="text-base">The customer&rsquo;s answer</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                {status === "EXPIRED" ? <p className="text-sm text-amber-700 dark:text-amber-400">This quote has expired. Extend it to record an answer.</p> : null}
                {status === "SENT" ? (
                  <>
                    <ActionForm action={decideQuoteAction} submitLabel="Customer approved" successMessage="Recorded.">
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <input type="hidden" name="decision" value="APPROVED" />
                      <TextAreaField label="How did they accept?" name="note" rows={2} placeholder="Replied by email, phoned the office..." />
                    </ActionForm>
                    <ActionForm action={decideQuoteAction} submitLabel="Customer declined" variant="outline" successMessage="Recorded.">
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <input type="hidden" name="decision" value="DECLINED" />
                      <TextAreaField label="Why?" name="note" rows={2} placeholder="Price, timing, went with someone else..." />
                    </ActionForm>
                  </>
                ) : null}
                <ActionForm action={extendQuoteValidityAction} submitLabel="Extend validity" variant="outline" successMessage="Extended.">
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <SelectField label="Extend by" name="days" defaultValue="14" options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }]} />
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
            <CardContent><Timeline events={timeline} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
