import Link from "next/link";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { weekSchedule } from "../../src/domain/jobs";
import { weekVisits } from "../../src/domain/siteVisits";
import { listTechnicians } from "../../src/domain/shared/staff";
import { addDaysKey, dayKey, formatDayKey, formatTime, weekDayKeys, weekStartKey } from "../../src/lib/tz";
import { PageHeader } from "../../src/ui/fields";
import { JobStatusChip, SiteVisitChip } from "../../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function SchedulePage(props: { searchParams: Promise<{ week?: string }> }) {
  await requireBusinessPage(Access.JOBS_READ);
  const { week } = await props.searchParams;
  const today = dayKey(new Date());
  const start = weekStartKey(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today);
  const days = weekDayKeys(start);
  const [{ scheduled, unscheduled, held }, technicians, visits] = await Promise.all([weekSchedule(start), listTechnicians(), weekVisits(start)]);
  const heldCell = (techId: string, day: string) => held.filter((j) => j.requestedUserId === techId && j.requestedStart && dayKey(j.requestedStart) === day);
  const visitCell = (techId: string, day: string) => visits.filter((v) => v.assignedUserId === techId && dayKey(v.scheduledStart) === day);
  const cell = (techId: string, day: string) => scheduled.filter((j) => j.assignedUserId === techId && dayKey(j.scheduledStart!) === day);
  const known = new Set(technicians.map((t) => t.id));
  const orphan = scheduled.filter((j) => j.assignedUserId && !known.has(j.assignedUserId));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Schedule"
        subtitle={`Week of ${formatDayKey(start)} - times are Sydney time`}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/schedule?week=${addDaysKey(start, -7)}`}>&larr; Previous</Link></Button>
            <Button asChild variant="outline"><Link href="/schedule">This week</Link></Button>
            <Button asChild variant="outline"><Link href={`/schedule?week=${addDaysKey(start, 7)}`}>Next &rarr;</Link></Button>
          </>
        }
      />
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] border-collapse text-sm" data-testid="schedule-grid">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-32 px-3 py-2 font-semibold">Technician</th>
              {days.map((d) => (
                <th key={d} className={`px-3 py-2 font-semibold ${d === today ? "text-foreground" : ""}`}>
                  {formatDayKey(d)}
                  {d === today ? <span className="ml-1 text-teal-accent">(today)</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {technicians.map((t) => (
              <tr key={t.id} className="border-b align-top last:border-0">
                <td className="px-3 py-2 font-medium">{t.name?.trim() || t.email}</td>
                {days.map((d) => (
                  <td key={d} className={`px-2 py-2 ${d === today ? "bg-muted/30" : ""}`}>
                    <div className="flex flex-col gap-1.5">
                      {visitCell(t.id, d).map((v) => (
                        <Link key={v.id} href={`/requests/${v.request.id}`} data-testid="schedule-visit" className="rounded-md border border-dashed bg-card p-1.5 text-xs hover:bg-muted">
                          <span className="font-semibold">{formatTime(v.scheduledStart)}-{formatTime(v.scheduledEnd)}</span>
                          <span className="block truncate">Site visit: {v.request.client?.name ?? v.request.summary}</span>
                          <span className="block truncate text-muted-foreground">{v.request.site?.suburb ?? ""}</span>
                          <SiteVisitChip status={v.status} />
                        </Link>
                      ))}
                      {heldCell(t.id, d).map((j) => (
                        <Link key={j.id} href={`/jobs/${j.id}`} data-testid="schedule-held" className="rounded-md border border-dashed bg-card p-1.5 text-xs hover:bg-muted">
                          <span className="font-semibold">{formatTime(j.requestedStart!)}-{formatTime(j.requestedEnd!)}</span>
                          <span className="block truncate">{j.number} {j.client.name}</span>
                          <span className="block truncate text-muted-foreground">{j.site?.suburb ?? ""}</span>
                          <span className="text-muted-foreground">Held - awaiting approval</span>
                        </Link>
                      ))}
                      {cell(t.id, d).map((j) => (
                        <Link key={j.id} href={`/jobs/${j.id}`} className="rounded-md border bg-card p-1.5 text-xs hover:bg-muted">
                          <span className="font-semibold">{formatTime(j.scheduledStart!)}-{formatTime(j.scheduledEnd!)}</span>
                          <span className="block truncate">{j.number} {j.client.name}</span>
                          <span className="block truncate text-muted-foreground">{j.site?.suburb ?? ""}</span>
                          <JobStatusChip status={j.status} />
                        </Link>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            {orphan.length > 0 ? (
              <tr>
                <td className="px-3 py-2 text-muted-foreground">Other</td>
                <td colSpan={7} className="px-2 py-2 text-xs text-muted-foreground">{orphan.map((j) => j.number).join(", ")} assigned to someone who is no longer a technician.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">To schedule ({unscheduled.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {unscheduled.length === 0 ? <p className="text-sm text-muted-foreground">Every job has a time.</p> : null}
          {unscheduled.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-muted">
              <span className="min-w-0 truncate"><span className="font-medium">{j.number}</span> {j.title} - {j.client.name}{j.site ? `, ${j.site.suburb}` : ""}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Schedule &rarr;</span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
