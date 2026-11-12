import Link from "next/link";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Card } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER, listJobs, type JobStatusValue } from "../../src/domain/jobs";
import { visitNote } from "../../src/domain/jobs/visitNote";
import { isDemoBugOn } from "../../src/domain/demo";
import { staffLabelMap } from "../../src/domain/shared/staff";
import { formatDayTime } from "../../src/lib/tz";
import { PageHeader } from "../../src/ui/fields";
import { JobStatusChip } from "../../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function JobsPage(props: { searchParams: Promise<{ status?: string; view?: string }> }) {
  await requireBusinessPage(Access.JOBS_READ);
  const { status, view } = await props.searchParams;
  const filter = JOB_STATUS_ORDER.find((s) => s === status) as JobStatusValue | undefined;
  const demoBug = await isDemoBugOn("job-schedule");
  const jobs = await listJobs({ status: filter, activeOnly: !filter && view === "active" });
  const labels = await staffLabelMap();
  const tab = (href: string, label: string, active: boolean) => (
    <Link key={label} href={href}>
      <Badge variant={active ? "default" : "outline"} className="px-3 py-1 text-sm">{label}</Badge>
    </Link>
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Jobs" subtitle="Work won from approved quotes, from scheduling to done." />
      <div className="flex flex-wrap gap-2">
        {tab("/jobs", "All", !filter && view !== "active")}
        {tab("/jobs?view=active", "Active", !filter && view === "active")}
        {tab("/jobs?status=UNSCHEDULED", "To schedule", filter === "UNSCHEDULED")}
        {tab("/jobs?status=COMPLETED", "Completed", filter === "COMPLETED")}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Job</th>
              <th className="px-4 py-2.5 font-semibold">Client</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Technician</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No jobs here.</td>
              </tr>
            ) : null}
            {jobs.map((j) => (
              <tr key={j.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.number}</Link>
                  <p className="text-xs text-muted-foreground">{j.title}</p>
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/clients/${j.client.id}`} className="hover:underline">{j.client.name}</Link>
                  {j.site ? <p className="text-xs text-muted-foreground">{j.site.suburb}</p> : null}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {j.scheduledStart ? formatDayTime(j.scheduledStart) : "-"}
                  <p className="text-muted-foreground">{visitNote(j, demoBug)}</p>
                </td>
                <td className="px-4 py-2.5 text-xs">{j.assignedUserId ? (labels.get(j.assignedUserId) ?? "-") : "-"}</td>
                <td className="px-4 py-2.5"><JobStatusChip status={j.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">{JOB_STATUS_LABEL.UNSCHEDULED}: waiting for a technician and a time.</p>
    </div>
  );
}
