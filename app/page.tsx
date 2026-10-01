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
import { PageHeader } from "../src/ui/fields";
import { RequestStatusChip, UrgencyChip } from "../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, roles } = await dashboardAccess();
  const canSeeRequests = hasAnyRole(roles, Access.REQUESTS);
  const [clientCount, byStatus, waiting, activity] = await Promise.all([
    appDb.client.count({ where: { archivedAt: null } }),
    canSeeRequests ? countByStatus() : null,
    canSeeRequests ? listRequests({ status: "NEW", limit: 5 }) : [],
    listRecentActivity(8),
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
