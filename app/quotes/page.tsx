import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { listQuotes, QUOTE_STATUS_LABEL, validityNote, type QuoteStatusValue } from "../../src/domain/quotes";
import { isDemoBugOn } from "../../src/domain/demo";
import { formatMoney } from "../../src/lib/money";
import { PageHeader } from "../../src/ui/fields";
import { QuoteStatusChip } from "../../src/ui/chips";

export const dynamic = "force-dynamic";
const STATUSES: QuoteStatusValue[] = ["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"];

export default async function QuotesPage(props: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireBusinessPage(Access.QUOTES_READ);
  const { status } = await props.searchParams;
  const filter = STATUSES.find((s) => s === status);
  const quotes = await listQuotes({ status: filter });
  const demoBug = await isDemoBugOn("quote-validity");
  const canWrite = hasAnyRole(user.roles, Access.QUOTES_WRITE);
  const tab = (href: string, label: string, active: boolean) => (
    <Link key={label} href={href}>
      <Badge variant={active ? "default" : "outline"} className="px-3 py-1 text-sm">{label}</Badge>
    </Link>
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Quotes" subtitle={`${quotes.length} ${filter ? QUOTE_STATUS_LABEL[filter].toLowerCase() : ""} ${quotes.length === 1 ? "quote" : "quotes"}`} actions={canWrite ? <Button asChild><Link href="/quotes/new">New quote</Link></Button> : null} />
      <div className="flex flex-wrap gap-2">
        {tab("/quotes", "All", !filter)}
        {STATUSES.map((s) => tab(`/quotes?status=${s}`, QUOTE_STATUS_LABEL[s], filter === s))}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Quote</th>
              <th className="px-4 py-2.5 font-semibold">Client</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Valid to</th>
              <th className="px-4 py-2.5 text-right font-semibold">Total incl GST</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No quotes here.</td>
              </tr>
            ) : null}
            {quotes.map((q) => (
              <tr key={q.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <Link href={`/quotes/${q.id}`} className="font-medium hover:underline">{q.number}</Link>
                  <p className="text-xs text-muted-foreground">{q.title}</p>
                </td>
                <td className="px-4 py-2.5"><Link href={`/clients/${q.client.id}`} className="hover:underline">{q.client.name}</Link></td>
                <td className="px-4 py-2.5"><QuoteStatusChip status={q.effectiveStatus} /></td>
                <td className="px-4 py-2.5 text-xs">
                  {q.status === "DRAFT" || !q.validUntil ? "-" : q.validUntil.toLocaleDateString("en-AU")}
                  <p className="text-muted-foreground">{validityNote(q, new Date(), demoBug)}</p>
                </td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(q.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
