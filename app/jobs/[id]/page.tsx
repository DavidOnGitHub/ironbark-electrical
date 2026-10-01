import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { getJob, JOB_STATUS_LABEL, JOB_TRANSITIONS } from "../../../src/domain/jobs";
import { listEntityTimeline } from "../../../src/domain/activity";
import { formatSite } from "../../../src/domain/clients";
import { listTechnicians, staffLabelMap } from "../../../src/domain/shared/staff";
import { addJobNoteAction, approveVariationAction, changeJobStatusAction, scheduleJobAction, unscheduleJobAction } from "../../../src/actions/jobs";
import { formatMoney } from "../../../src/lib/money";
import { dateToSydneyLocal, formatDayTime, tomorrowLocalPrefix } from "../../../src/lib/tz";
import { ActionForm } from "../../../src/ui/ActionForm";
import { Field, PageHeader, SelectField, TextAreaField } from "../../../src/ui/fields";
import { JobStatusChip } from "../../../src/ui/chips";
import { Timeline } from "../../../src/ui/Timeline";

export const dynamic = "force-dynamic";

export default async function JobPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireBusinessPage(Access.JOBS_READ);
  const { id } = await props.params;
  const job = await getJob(id);
  if (!job) notFound();
  const canWrite = hasAnyRole(user.roles, Access.JOBS_WRITE);
  const [timeline, technicians, labels] = await Promise.all([listEntityTimeline("job", id), canWrite ? listTechnicians() : Promise.resolve([]), staffLabelMap()]);
  // Scheduling moves go through the Schedule card; invoicing moves belong to the invoicing module (next phase).
  const fieldMoves = JOB_TRANSITIONS[job.status].filter((s) => !["UNSCHEDULED", "SCHEDULED", "INVOICED", "PAID"].includes(s));
  const canSchedule = canWrite && ["UNSCHEDULED", "SCHEDULED", "ON_HOLD"].includes(job.status);
  const approvedExtra = job.notes.filter((n) => n.kind === "VARIATION" && n.approved).reduce((sum, n) => sum + (n.extraCents ?? 0), 0);
  const tomorrow = tomorrowLocalPrefix();

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">&larr; Jobs</Link>
      <PageHeader
        title={`${job.number} - ${job.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <JobStatusChip status={job.status} />
            <span>for <Link className="underline" href={`/clients/${job.client.id}`}>{job.client.name}</Link></span>
            {job.quote ? <Link className="underline" href={`/quotes/${job.quote.id}`}>quote {job.quote.number}</Link> : null}
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle className="text-base">The job</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {job.scope ? <p className="whitespace-pre-wrap">{job.scope}</p> : null}
              {job.site ? (
                <dl className="grid gap-1.5">
                  <div><dt className="text-xs text-muted-foreground">Site</dt><dd>{formatSite(job.site)}</dd></div>
                  {job.site.accessNotes ? <div><dt className="text-xs text-muted-foreground">Access</dt><dd>{job.site.accessNotes}</dd></div> : null}
                  {job.site.switchboardNotes ? <div><dt className="text-xs text-muted-foreground">Switchboard</dt><dd>{job.site.switchboardNotes}</dd></div> : null}
                </dl>
              ) : <p className="text-muted-foreground">No site recorded.</p>}
              <dl className="grid gap-1.5 text-xs text-muted-foreground">
                <div>Quoted (ex GST): {formatMoney(job.quotedSubtotalCents)}{approvedExtra ? ` + ${formatMoney(approvedExtra)} approved variations` : ""}</div>
                {job.scheduledStart && job.scheduledEnd ? <div>Booked: {formatDayTime(job.scheduledStart)} to {formatDayTime(job.scheduledEnd)}{job.assignedUserId ? ` - ${labels.get(job.assignedUserId) ?? ""}` : ""}</div> : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Notes and variations</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              {canWrite ? (
                <ActionForm action={addJobNoteAction} submitLabel="Add" resetOnSuccess variant="outline">
                  <input type="hidden" name="jobId" value={job.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SelectField label="Type" name="kind" options={[{ value: "NOTE", label: "Note" }, { value: "VARIATION", label: "Variation (extra work)" }]} />
                    <Field label="Extra amount ex GST ($)" name="extra" hint="Variations only" className="sm:col-span-2" />
                  </div>
                  <TextAreaField label="Details" name="text" rows={2} />
                </ActionForm>
              ) : null}
              <ul className="flex flex-col gap-2 text-sm">
                {job.notes.length === 0 ? <li className="text-muted-foreground">Nothing yet.</li> : null}
                {job.notes.map((n) => (
                  <li key={n.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="whitespace-pre-wrap">{n.text}</p>
                      {n.kind === "VARIATION" ? (
                        <Badge variant="outline" className={n.approved ? "border-green-400 text-green-800 dark:text-green-300" : "border-amber-400 text-amber-900 dark:text-amber-300"}>
                          Variation {formatMoney(n.extraCents ?? 0)} {n.approved ? "approved" : "pending"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{n.authorLabel} - {formatDayTime(n.createdAt)}</p>
                    {n.kind === "VARIATION" && canWrite ? (
                      <form action={approveVariationAction} className="mt-2">
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="approved" value={n.approved ? "no" : "yes"} />
                        <Button type="submit" size="sm" variant="outline">{n.approved ? "Withdraw approval" : "Approve variation"}</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {canSchedule ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ActionForm action={scheduleJobAction} submitLabel={job.status === "SCHEDULED" ? "Reschedule" : "Schedule"} successMessage="Scheduled.">
                  <input type="hidden" name="jobId" value={job.id} />
                  <SelectField
                    label="Technician"
                    name="assignedUserId"
                    required
                    defaultValue={job.assignedUserId ?? ""}
                    options={[{ value: "", label: "Choose..." }, ...technicians.map((t) => ({ value: t.id, label: t.name?.trim() || t.email }))]}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Start" name="start" type="datetime-local" required defaultValue={job.scheduledStart ? dateToSydneyLocal(job.scheduledStart) : `${tomorrow}08:00`} />
                    <Field label="End" name="end" type="datetime-local" required defaultValue={job.scheduledEnd ? dateToSydneyLocal(job.scheduledEnd) : `${tomorrow}12:00`} />
                  </div>
                  <p className="text-xs text-muted-foreground">Times are Sydney time.</p>
                </ActionForm>
                {job.status === "SCHEDULED" ? (
                  <ActionForm action={unscheduleJobAction} submitLabel="Unschedule" variant="outline">
                    <input type="hidden" name="jobId" value={job.id} />
                  </ActionForm>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {canWrite && fieldMoves.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Progress</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={changeJobStatusAction} submitLabel="Update status" successMessage="Updated.">
                  <input type="hidden" name="jobId" value={job.id} />
                  <SelectField label={`Move from ${JOB_STATUS_LABEL[job.status].toLowerCase()} to`} name="to" required options={fieldMoves.map((s) => ({ value: s, label: JOB_STATUS_LABEL[s] }))} defaultValue={fieldMoves[0]} />
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
