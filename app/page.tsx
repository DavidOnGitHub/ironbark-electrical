import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { StatTile } from "@kabosh-digital/m-street-kit/components/StatTile";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { Access } from "../src/access";
import { dashboardAccess } from "../src/guard";
import { listRecentActivity } from "../src/domain/activity";
import { countByStatus, formatAge, listRequests, requestAgeHours } from "../src/domain/requests";
import { appDb } from "../src/db/app";
import { openQuoteStats } from "../src/domain/quotes";
import { countJobsByStatus, weekSchedule } from "../src/domain/jobs";
import { dayKey, weekStartKey } from "../src/lib/tz";
import { formatMoney } from "../src/lib/money";
import { receivablesSummary } from "../src/domain/invoicing";
import { PageHeader } from "../src/ui/fields";
import { RequestStatusChip, UrgencyChip } from "../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, roles } = await dashboardAccess();
  const canSeeRequests = hasAnyRole(roles, Access.REQUESTS);
  const canSeeWork = hasAnyRole(roles, Access.QUOTES_READ);
  const canSeeMoney = hasAnyRole(roles, Access.INVOICES_READ);
  const [clientCount, byStatus, waiting, activity, quoteStats, jobCounts, week, money] = await Promise.all([
    appDb.client.count({ where: { archivedAt: null } }),
    canSeeRequests ? countByStatus() : null,
    canSeeRequests ? listRequests({ status: "NEW", limit: 5 }) : [],
    listRecentActivity(8),
    canSeeWork ? openQuoteStats() : null,
    canSeeWork ? countJobsByStatus() : null,
    canSeeWork ? weekSchedule(weekStartKey(dayKey(new Date()))) : null,
    canSeeMoney ? receivablesSummary() : null,
  ]);
  const open = byStatus ? byStatus.NEW + byStatus.CONTACTED + byStatus.SITE_VISIT_BOOKED + byStatus.QUOTED : 0;
  const oldestNew = waiting.length ? Math.max(...waiting.map((r) => requestAgeHours(r.receivedAt))) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Good day, ${user.name?.split(" ")[0] ?? "there"}`} subtitle="Ironbark Electrical - here is where things stand." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {byStatus ? (
          <>
            <StatTile href="/requests" label="New enquiries" value={byStatus.NEW} sub={byStatus.NEW ? `oldest waiting ${formatAge(oldestNew)}` : "all answered"} tone={byStatus.NEW > 0 && oldestNew > 24 ? "warn" : "default"} />
            <StatTile href="/requests" label="Open requests" value={open} sub={`${byStatus.QUOTED} quoted`} />
            <StatTile href="/requests" label="Won / lost" value={`${byStatus.WON} / ${byStatus.LOST}`} sub="all time" />
          </>
        ) : null}
        {quoteStats ? <StatTile href="/quotes?status=SENT" label="Open quotes" value={quoteStats.count} sub={`${formatMoney(quoteStats.totalCents)} incl GST waiting on customers`} /> : null}
        {jobCounts && week ? <StatTile href="/schedule" label="Jobs this week" value={week.scheduled.length} sub={`${jobCounts.IN_PROGRESS} in progress`} /> : null}
        {jobCounts ? <StatTile href="/schedule" label="To schedule" value={jobCounts.UNSCHEDULED} sub="approved, no time yet" tone={jobCounts.UNSCHEDULED > 0 ? "warn" : "default"} /> : null}
        {money ? <StatTile href="/invoices" label="Outstanding" value={formatMoney(money.outstandingCents)} sub={`${money.outstandingCount} unpaid invoices`} /> : null}
        {money ? <StatTile href="/invoices?status=OVERDUE" label="Overdue" value={formatMoney(money.overdueCents)} sub={`${money.overdue.length} past due`} tone={money.overdue.length > 0 ? "crit" : "default"} /> : null}
        {jobCounts ? <StatTile href="/invoices" label="Ready to invoice" value={jobCounts.COMPLETED} sub="completed, no invoice yet" tone={jobCounts.COMPLETED > 0 ? "warn" : "default"} /> : null}
        <StatTile href="/clients" label="Clients" value={clientCount} sub="active" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {canSeeRequests ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Waiting for a first reply</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {waiting.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting. </p> : null}
              {waiting.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-muted">
                  <span className="min-w-0 truncate font-medium">{r.summary}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <UrgencyChip urgency={r.urgency} />
                    <RequestStatusChip status={r.status} />
                    <span className="text-xs text-muted-foreground">{formatAge(requestAgeHours(r.receivedAt))}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}
        {money && money.overdue.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overdue invoices</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {money.overdue.slice(0, 5).map((o) => (
                <Link key={o.id} href={`/invoices/${o.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-muted" data-testid="overdue-row">
                  <span className="min-w-0 truncate"><span className="font-medium">{o.number}</span> {o.clientName}<span className="block text-xs text-muted-foreground">{o.chase.action}</span></span>
                  <span className="shrink-0 text-right"><span className="block tabular-nums">{formatMoney(o.balanceCents)}</span><span className="text-xs text-red-700 dark:text-red-400">{o.daysOverdue} d overdue</span></span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {activity.length === 0 ? <p className="text-muted-foreground">No activity yet.</p> : null}
            {activity.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate">{e.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.actorLabel}
                    {e.client ? (
                      <>
                        {" "}
                        - <Link href={`/clients/${e.client.id}`} className="underline">{e.client.name}</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(e.at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
