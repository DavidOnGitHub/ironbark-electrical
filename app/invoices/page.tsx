import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { StatTile } from "@kabosh-digital/m-street-kit/components/StatTile";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { INVOICE_STATUS_LABEL, listInvoices, receivablesSummary, type EffectiveInvoiceStatus } from "../../src/domain/invoicing";
import { listJobsReadyToInvoice } from "../../src/domain/jobs";
import { createInvoiceAction } from "../../src/actions/invoicing";
import { formatMoney } from "../../src/lib/money";
import { formatDayTime } from "../../src/lib/tz";
import { ActionForm } from "../../src/ui/ActionForm";
import { PageHeader } from "../../src/ui/fields";
import { InvoiceStatusChip } from "../../src/ui/chips";

export const dynamic = "force-dynamic";
const STATUSES: EffectiveInvoiceStatus[] = ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE", "PAID", "VOID"];

export default async function InvoicesPage(props: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireBusinessPage(Access.INVOICES_READ);
  const { status } = await props.searchParams;
  const filter = STATUSES.find((s) => s === status);
  const canWrite = hasAnyRole(user.roles, Access.INVOICES_WRITE);
  const [invoices, summary, ready] = await Promise.all([listInvoices({ status: filter }), receivablesSummary(), listJobsReadyToInvoice()]);
  const tab = (href: string, label: string, active: boolean) => (
    <Link key={label} href={href}>
      <Badge variant={active ? "default" : "outline"} className="px-3 py-1 text-sm">{label}</Badge>
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Invoices" subtitle="Drafted from completed jobs, reviewed, issued, paid." actions={<Button asChild variant="outline"><Link href="/invoices/export" prefetch={false} download>Export CSV</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={formatMoney(summary.outstandingCents)} sub={`${summary.outstandingCount} unpaid ${summary.outstandingCount === 1 ? "invoice" : "invoices"}`} />
        <StatTile href="/invoices?status=OVERDUE" label="Overdue" value={formatMoney(summary.overdueCents)} sub={`${summary.overdue.length} past due`} tone={summary.overdue.length > 0 ? "crit" : "default"} />
        <StatTile label="Received this month" value={formatMoney(summary.receivedThisMonthCents)} sub="payments and deposits" />
        <StatTile label="Ready to invoice" value={ready.length} sub="completed, no invoice yet" tone={ready.length > 0 ? "warn" : "default"} />
      </div>

      {ready.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Completed jobs ready to invoice ({ready.length})</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {ready.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-2.5 text-sm" data-testid="ready-job">
                <span className="min-w-0 truncate">
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.number}</Link> {j.title} - {j.client.name}
                  {j.completedAt ? <span className="text-xs text-muted-foreground"> - completed {formatDayTime(j.completedAt)}</span> : null}
                </span>
                {canWrite ? (
                  <ActionForm action={createInvoiceAction} submitLabel="Create invoice" pendingLabel="Creating..." variant="outline" className="gap-0">
                    <input type="hidden" name="jobId" value={j.id} />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tab("/invoices", "All", !filter)}
        {STATUSES.map((s) => tab(`/invoices?status=${s}`, INVOICE_STATUS_LABEL[s], filter === s))}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Invoice</th>
              <th className="px-4 py-2.5 font-semibold">Client</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Due</th>
              <th className="px-4 py-2.5 text-right font-semibold">Total incl GST</th>
              <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No invoices here.</td>
              </tr>
            ) : null}
            {invoices.map((i) => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">{i.number}</Link>
                  <p className="text-xs text-muted-foreground">{i.job.number}</p>
                </td>
                <td className="px-4 py-2.5"><Link href={`/clients/${i.client.id}`} className="hover:underline">{i.client.name}</Link></td>
                <td className="px-4 py-2.5">
                  <InvoiceStatusChip status={i.effectiveStatus} />
                  {i.daysOverdue > 0 ? <span className="ml-2 text-xs text-red-700 dark:text-red-400">{i.daysOverdue} d</span> : null}
                </td>
                <td className="px-4 py-2.5 text-xs">{i.dueAt ? i.dueAt.toLocaleDateString("en-AU") : "-"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(i.totalCents)}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">{i.status === "VOID" ? "-" : formatMoney(i.balanceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
