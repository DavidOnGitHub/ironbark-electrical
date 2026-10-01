import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { getInvoice, GST_RATE_PCT } from "../../../src/domain/invoicing";
import { listEntityTimeline } from "../../../src/domain/activity";
import { formatSite } from "../../../src/domain/clients";
import { issueInvoiceAction, recordPaymentAction, saveInvoiceLinesAction, voidInvoiceAction } from "../../../src/actions/invoicing";
import { centsToInput, formatMoney } from "../../../src/lib/money";
import { formatDayTime } from "../../../src/lib/tz";
import { ActionForm } from "../../../src/ui/ActionForm";
import { Field, PageHeader, SelectField, TextAreaField } from "../../../src/ui/fields";
import { InvoiceStatusChip } from "../../../src/ui/chips";
import { QuoteEditor } from "../../../src/ui/QuoteEditor";
import { PrintButton } from "../../../src/ui/PrintButton";
import { Timeline } from "../../../src/ui/Timeline";

export const dynamic = "force-dynamic";

const METHODS = [{ value: "BANK", label: "Bank transfer" }, { value: "CARD", label: "Card" }, { value: "CASH", label: "Cash" }];

export default async function InvoicePage(props: { params: Promise<{ id: string }> }) {
  const user = await requireBusinessPage(Access.INVOICES_READ);
  const { id } = await props.params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  const canWrite = hasAnyRole(user.roles, Access.INVOICES_WRITE);
  const timeline = await listEntityTimeline("invoice", id);
  const status = invoice.effectiveStatus;
  const editable = invoice.status === "DRAFT" && canWrite;
  const canTakePayment = canWrite && (invoice.status === "SENT" || invoice.status === "PARTIALLY_PAID");
  const canVoid = canWrite && (invoice.status === "DRAFT" || (invoice.status === "SENT" && invoice.payments.filter((p) => p.kind === "INVOICE").length === 0));

  return (
    <div className="flex flex-col gap-5">
      <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">&larr; Invoices</Link>
      <PageHeader
        title={`${invoice.number} - ${invoice.job.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <InvoiceStatusChip status={status} />
            <span>for <Link className="underline" href={`/clients/${invoice.client.id}`}>{invoice.client.name}</Link>{invoice.job.site ? ` - ${formatSite(invoice.job.site)}` : ""}</span>
            <Link className="underline" href={`/jobs/${invoice.job.id}`}>job {invoice.job.number}</Link>
            {invoice.job.quote ? <Link className="underline" href={`/quotes/${invoice.job.quote.id}`}>quote {invoice.job.quote.number}</Link> : null}
          </span>
        }
        actions={<PrintButton label="Print / save as PDF" />}
      />
      {status === "OVERDUE" ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">{invoice.daysOverdue} {invoice.daysOverdue === 1 ? "day" : "days"} overdue - {formatMoney(invoice.balanceCents)} owing.</p>
          <p>Next step in the chasing routine: {invoice.chase.action.toLowerCase()}.</p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {editable ? (
              <>
                <p className="text-sm text-muted-foreground">Check this against the job before it goes out. Quote lines and approved variations are filled in; adjust anything that changed.</p>
                <QuoteEditor
                  quoteId={invoice.id}
                  idName="invoiceId"
                  saveLabel="Save changes"
                  action={saveInvoiceLinesAction}
                  priceItems={[]}
                  initialLines={invoice.lines.map((l) => ({ source: l.source, description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unitPriceCents }))}
                />
              </>
            ) : (
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
                    {invoice.lines.map((l) => (
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
            )}
            <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" data-testid="invoice-totals">
              <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{formatMoney(invoice.subtotalCents)}</dd>
              <dt className="text-muted-foreground">GST ({GST_RATE_PCT}%)</dt><dd className="text-right tabular-nums">{formatMoney(invoice.gstCents)}</dd>
              <dt className="font-semibold">Total incl GST</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(invoice.totalCents)}</dd>
              {invoice.creditCents > 0 ? (<><dt className="text-muted-foreground">Deposit received</dt><dd className="text-right tabular-nums">-{formatMoney(invoice.creditCents)}</dd></>) : null}
              {invoice.paidCents > 0 ? (<><dt className="text-muted-foreground">Payments received</dt><dd className="text-right tabular-nums">-{formatMoney(invoice.paidCents)}</dd></>) : null}
              <dt className="font-semibold">Balance due</dt><dd className="text-right font-semibold tabular-nums" data-testid="balance">{formatMoney(invoice.balanceCents)}</dd>
            </dl>
            {invoice.notes && !editable ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{invoice.notes}</p> : null}
            {invoice.issuedAt ? <p className="text-xs text-muted-foreground">Issued {invoice.issuedAt.toLocaleDateString("en-AU")}. Due {invoice.dueAt?.toLocaleDateString("en-AU")} (7-day terms).{invoice.voidReason ? ` Voided: ${invoice.voidReason}` : ""}</p> : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          {canWrite && invoice.status === "DRAFT" ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Issue</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">Once you are happy with the lines, issue it. That starts the 7-day payment terms and marks the job Invoiced. Emailing it with a payment link arrives with the invoice workflow.</p>
                <ActionForm action={issueInvoiceAction} submitLabel="Issue invoice" successMessage="Issued.">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
          {canTakePayment ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Record a payment</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={recordPaymentAction} submitLabel="Record payment" successMessage="Recorded." resetOnSuccess>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <Field label="Amount received ($)" name="amount" defaultValue={centsToInput(invoice.balanceCents)} required />
                  <SelectField label="Method" name="method" options={METHODS} defaultValue="BANK" />
                  <Field label="Reference" name="reference" placeholder="EFT reference, last 4 of card..." />
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
          {invoice.payments.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Money received</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm" data-testid="payments">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                      <span>{p.kind === "DEPOSIT" ? "Deposit" : "Payment"} - {p.method.toLowerCase()}{p.reference ? ` (${p.reference})` : ""}<span className="block text-xs text-muted-foreground">{formatDayTime(p.paidAt)}</span></span>
                      <span className="tabular-nums">{formatMoney(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {canVoid ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Void</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={voidInvoiceAction} submitLabel="Void invoice" variant="outline">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <TextAreaField label="Why?" name="reason" rows={2} placeholder="Raised in error, wrong customer..." />
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
