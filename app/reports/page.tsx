import Link from "next/link";
import { StatTile } from "@kabosh-digital/m-street-kit/components/StatTile";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { REPORT_WINDOWS, businessReport, type ReportWindow } from "../../src/domain/reports";
import { formatMoney } from "../../src/lib/money";
import { PageHeader } from "../../src/ui/fields";

export const dynamic = "force-dynamic";

const dash = (v: number | null, unit = "") => (v == null ? "-" : `${v}${unit}`);
const days = (v: number | null) => (v == null ? "-" : `${v.toFixed(1)} d`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireBusinessPage(Access.REPORTS);
  const requested = Number((await searchParams).days);
  const window = (REPORT_WINDOWS as readonly number[]).includes(requested) ? (requested as ReportWindow) : 90;
  const r = await businessReport(window);
  const maxReceipt = Math.max(1, ...r.receipts.map((m) => m.cents));
  const maxTech = Math.max(1, ...r.technicians.map((t) => t.cents));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" subtitle={`How the business is converting enquiries and getting paid - last ${window} days.`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {REPORT_WINDOWS.map((w) => (
          <Link key={w} href={`/reports?days=${w}`} className={`rounded-md border px-3 py-1 ${w === window ? "bg-muted font-medium" : "hover:bg-muted"}`}>
            {w === 365 ? "12 months" : `${w} days`}
          </Link>
        ))}
        <a href="/invoices/export" className="ml-auto rounded-md border px-3 py-1 hover:bg-muted" data-testid="export-link">Export invoices and payments (CSV)</a>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Enquiries" value={r.funnel.total} sub={`${dash(r.funnel.quotedPct, "%")} reached a quote`} />
        <StatTile label="Enquiries won" value={dash(r.funnel.wonPct, "%")} sub={`${r.funnel.won} of ${r.funnel.total}`} />
        <StatTile label="Quote approval" value={dash(r.quotes.approvalPct, "%")} sub={`${r.quotes.approved} of ${r.quotes.sent} sent quotes`} />
        <StatTile label="Quote to decision" value={days(r.quotes.medianDaysToDecision)} sub="median wait for the customer" />
        <StatTile label="Job done to invoice" value={days(r.billing.medianDaysToInvoice)} sub="median" />
        <StatTile label="Invoice to paid" value={days(r.billing.medianDaysToPaid)} sub="median" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Money received, by month</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2" data-testid="receipts">
            {r.receipts.map((m) => (
              <div key={m.key} className="flex items-center gap-3 text-sm">
                <span className="w-10 shrink-0 text-muted-foreground">{MONTHS[Number(m.key.slice(5)) - 1]}</span>
                <span className="flex h-3 flex-1 items-center"><span className="h-3 rounded bg-primary" style={{ width: `${Math.round((m.cents / maxReceipt) * 100)}%`, minWidth: m.cents ? 4 : 0 }} /></span>
                <span className="w-24 shrink-0 text-right tabular-nums">{formatMoney(m.cents)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Invoiced by technician (ex GST)</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2" data-testid="by-technician">
            {r.technicians.length === 0 ? <p className="text-sm text-muted-foreground">No invoiced jobs in this period.</p> : null}
            {r.technicians.map((t) => (
              <div key={t.userId ?? "none"} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate">{t.name}</span>
                <span className="flex h-3 flex-1 items-center"><span className="h-3 rounded bg-primary" style={{ width: `${Math.round((t.cents / maxTech) * 100)}%`, minWidth: 4 }} /></span>
                <span className="shrink-0 text-right tabular-nums">{formatMoney(t.cents)} <span className="text-xs text-muted-foreground">({t.jobs} jobs)</span></span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
