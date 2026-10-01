import Link from "next/link";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { formatAge, isOpenStatus, listRequests, REQUEST_STATUS_LABEL, REQUEST_STATUS_ORDER, requestAgeHours } from "../../src/domain/requests";
import { staffLabelMap } from "../../src/domain/shared/staff";
import { PageHeader } from "../../src/ui/fields";
import { CATEGORY_LABEL, RequestStatusChip, UrgencyChip } from "../../src/ui/chips";
import type { RequestStatus } from "iron-spark-client";

export const dynamic = "force-dynamic";

export default async function RequestsPage(props: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const user = await requireBusinessPage(Access.REQUESTS);
  const { status, mine } = await props.searchParams;
  const filterStatus = REQUEST_STATUS_ORDER.find((s) => s === status) as RequestStatus | undefined;
  const [requests, labels] = await Promise.all([
    listRequests({ status: filterStatus, ownerUserId: mine === "1" ? user.id : undefined, openOnly: !filterStatus }),
    staffLabelMap(),
  ]);
  const sections = (filterStatus ? [filterStatus] : REQUEST_STATUS_ORDER.filter(isOpenStatus)).map((s) => ({
    status: s,
    rows: requests.filter((r) => r.status === s),
  }));
  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href}>
      <Badge variant={active ? "default" : "outline"} className="px-3 py-1 text-sm">{label}</Badge>
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Requests" subtitle="Enquiries from first contact to won or lost." actions={<Button asChild><Link href="/requests/new">New request</Link></Button>} />
      <div className="flex flex-wrap gap-2">
        {tab(`/requests${mine === "1" ? "?mine=1" : ""}`, "Open", !filterStatus)}
        {tab("/requests?status=WON", "Won", filterStatus === "WON")}
        {tab("/requests?status=LOST", "Lost", filterStatus === "LOST")}
        <span className="mx-1 text-muted-foreground">|</span>
        {tab(`/requests${filterStatus ? `?status=${filterStatus}&` : "?"}mine=1`, "Mine", mine === "1")}
      </div>
      {sections.map((section) => (
        <div key={section.status} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {REQUEST_STATUS_LABEL[section.status]} <span className="text-muted-foreground">({section.rows.length})</span>
          </h2>
          <Card className="p-0">
            {section.rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nothing here.</p> : null}
            {section.rows.map((r) => (
              <Link key={r.id} href={`/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0 hover:bg-muted/40">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.client?.name ?? r.contactName ?? r.contactEmail ?? "Unknown contact"}
                    {r.site ? ` - ${r.site.suburb}` : ""} - {CATEGORY_LABEL[r.category]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <UrgencyChip urgency={r.urgency} />
                  <RequestStatusChip status={r.status} />
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatAge(requestAgeHours(r.receivedAt))}</span>
                  <span className="w-20 truncate text-right text-xs text-muted-foreground">{r.ownerUserId ? (labels.get(r.ownerUserId) ?? "-") : "unassigned"}</span>
                </div>
              </Link>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
