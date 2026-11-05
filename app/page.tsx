import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../src/access";
import { dashboardAccess } from "../src/guard";
import { listRecentActivity } from "../src/domain/activity";
import { countByStatus, listRequests, requestAgeHours } from "../src/domain/requests";
import { openQuoteStats } from "../src/domain/quotes";
import { countJobsByStatus, listJobsReadyToInvoice, weekSchedule } from "../src/domain/jobs";
import { receivablesSummary } from "../src/domain/invoicing";
import { staffLabelMap } from "../src/domain/shared/staff";
import { dayKey, formatDayKey, formatTime, weekStartKey } from "../src/lib/tz";
import { formatMoney } from "../src/lib/money";
import { PageHeader } from "../src/ui/fields";
import { Age, Kpi, Money, Panel, Row, Rows } from "../src/ui/kit";
import { JobStatusChip, JobTag, UrgencyChip, SOURCE_LABEL } from "../src/ui/chips";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";

export const dynamic = "force-dynamic";

const ICON = "size-4";
const svg = (d: string) => (
  <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ACTIVITY_ICON: Record<string, string> = {
  request: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  quote: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  job: "M20 6 9 17l-5-5",
  invoice: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  payment: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  client: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
const BOLT = "M13 2 3 14h9l-1 8 10-12h-9l1-8z";

export default async function DashboardPage() {
  const { user, roles } = await dashboardAccess();
  const canSeeRequests = hasAnyRole(roles, Access.REQUESTS);
  const canSeeWork = hasAnyRole(roles, Access.QUOTES_READ);
  const canSeeMoney = hasAnyRole(roles, Access.INVOICES_READ);
  const today = dayKey(new Date());
  const [byStatus, waiting, activity, quoteStats, jobCounts, week, tools, money, ready, names] = await Promise.all([
    canSeeRequests ? countByStatus() : null,
    canSeeRequests ? listRequests({ status: "NEW", limit: 50 }) : [],
    listRecentActivity(7),
    canSeeWork ? openQuoteStats() : null,
    canSeeWork ? countJobsByStatus() : null,
    canSeeWork ? weekSchedule(weekStartKey(today)) : null,
    canSeeWork ? weekSchedule(today, 1) : null,
    canSeeMoney ? receivablesSummary() : null,
    canSeeMoney ? listJobsReadyToInvoice() : [],
    staffLabelMap(),
  ]);
  const ages = waiting.map((r) => requestAgeHours(r.receivedAt));
  const oldest = ages.length ? Math.max(...ages) : 0;
  const readyCents = ready.reduce((sum, j) => sum + Math.round(j.quotedSubtotalCents * 1.1), 0);
  const first = user.name?.split(" ")[0] ?? "there";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`Good day, ${first}`} subtitle={`${formatDayKey(today)}. Here is what needs you today.`} />

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {byStatus ? (
          <Kpi href="/requests" label="New enquiries" value={byStatus.NEW} tone={byStatus.NEW > 0 ? "warn" : "neutral"} sub={byStatus.NEW ? `Oldest waiting ${Math.round(oldest)} h` : "All answered"} />
        ) : null}
        {quoteStats ? <Kpi href="/quotes?status=SENT" label="Open quotes" value={<Money cents={quoteStats.totalCents} />} tone="info" sub={`${quoteStats.count} ${quoteStats.count === 1 ? "quote" : "quotes"}, incl GST`} /> : null}
        {money ? (
          <Kpi href="/invoices" label="Owed to you" value={<Money cents={money.outstandingCents} />} tone={money.overdue.length > 0 ? "bad" : "neutral"} sub={money.overdue.length ? `${formatMoney(money.overdueCents)} overdue` : `${money.outstandingCount} unpaid invoices`} />
        ) : null}
        {jobCounts && week ? (
          <Kpi href="/schedule" label="Jobs this week" value={week.scheduled.length} tone={jobCounts.UNSCHEDULED > 0 ? "warn" : "neutral"} sub={jobCounts.UNSCHEDULED > 0 ? `${jobCounts.UNSCHEDULED} approved ${jobCounts.UNSCHEDULED === 1 ? "job" : "jobs"} to schedule` : `${jobCounts.IN_PROGRESS} in progress`} />
        ) : null}
      </section>

      {ready.length > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-status-info/30 bg-status-info-soft px-4 py-3">
          <p className="min-w-56 flex-1">
            <strong>{ready.length} completed {ready.length === 1 ? "job is" : "jobs are"} ready to invoice</strong>, worth {formatMoney(readyCents)} incl GST.
          </p>
          <Link href="/invoices" className="inline-flex h-9 items-center rounded bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Review and invoice
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          {canSeeRequests ? (
            <Panel title="Waiting for a first reply" count={waiting.length} more={{ href: "/requests", label: "All requests" }}>
              <Rows empty="Nothing waiting. Every enquiry has had a reply.">
                {waiting.slice(0, 5).map((r) => (
                  <Row
                    key={r.id}
                    href={`/requests/${r.id}`}
                    title={r.summary}
                    meta={[r.client?.name ?? r.contactName, r.site?.suburb, `by ${SOURCE_LABEL[r.source]?.toLowerCase() ?? r.source.toLowerCase()}`].filter(Boolean).join(", ")}
                    side={
                      <>
                        <UrgencyChip urgency={r.urgency} />
                        <Age hours={requestAgeHours(r.receivedAt)} />
                      </>
                    }
                  />
                ))}
              </Rows>
            </Panel>
          ) : null}
          {money && money.overdue.length > 0 ? (
            <Panel title="Overdue invoices" count={money.overdue.length} more={{ href: "/invoices?status=OVERDUE", label: "All invoices" }}>
              <Rows>
                {money.overdue.slice(0, 5).map((o) => (
                  <Row
                    key={o.id}
                    href={`/invoices/${o.id}`}
                    title={<>{o.number} <span className="font-medium">{o.clientName}</span></>}
                    meta={o.chase.action}
                    side={
                      <div>
                        <span className="block font-bold tabular-nums"><Money cents={o.balanceCents} /></span>
                        <span className="block text-[0.8rem] font-semibold text-status-bad">{o.daysOverdue} days overdue</span>
                      </div>
                    }
                  />
                ))}
              </Rows>
            </Panel>
          ) : null}
        </div>

        <div className="grid gap-5">
          {tools ? (
            <Panel title="On the tools today" more={{ href: "/schedule", label: "Schedule" }}>
              <Rows empty="Nothing scheduled today.">
                {tools.scheduled.map((j) => (
                  <Row
                    key={j.id}
                    href={`/jobs/${j.id}`}
                    lead={<span className="min-w-11 text-sm font-semibold tabular-nums">{j.scheduledStart ? formatTime(j.scheduledStart) : ""}</span>}
                    title={j.title}
                    meta={
                      <>
                        <JobTag number={j.number} /> {[j.site?.suburb, j.assignedUserId ? names.get(j.assignedUserId)?.split(" ")[0] : null].filter(Boolean).join(", ")}
                      </>
                    }
                    side={<JobStatusChip status={j.status} />}
                  />
                ))}
              </Rows>
            </Panel>
          ) : null}
          <Panel title="Latest activities">
            <Rows empty="No activity yet.">
              {activity.map((e) => (
                <Row
                  key={e.id}
                  lead={<span className="grid size-8 shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground">{svg(e.actorType === "WORKFLOW" ? BOLT : (ACTIVITY_ICON[e.entityType] ?? ACTIVITY_ICON.job))}</span>}
                  title={<span className="font-medium whitespace-normal">{e.summary}</span>}
                  meta={[e.actorLabel, e.client?.name].filter(Boolean).join(" - ")}
                  side={<span className="text-[0.84rem] text-muted-foreground">{formatRelativeTime(e.at)}</span>}
                />
              ))}
            </Rows>
          </Panel>
        </div>
      </div>
    </div>
  );
}
