import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { JOB_TRANSITIONS, listJobsForTechnician, JOB_STATUS_LABEL, type JobStatusValue, technicianCanMoveJob } from "../../src/domain/jobs";
import { fieldAddNoteAction, fieldChangeStatusAction } from "../../src/actions/jobs";
import { fieldCompleteSiteVisitAction } from "../../src/actions/siteVisits";
import { listVisitsForTechnician } from "../../src/domain/siteVisits";
import { dayKey, formatDayKey, formatDayTime, formatTime } from "../../src/lib/tz";
import { ActionForm } from "../../src/ui/ActionForm";
import { Field, PageHeader, SelectField, TextAreaField } from "../../src/ui/fields";
import { JobStatusChip, JobTag, SiteVisitChip } from "../../src/ui/chips";

export const dynamic = "force-dynamic";

const TAP_LINK = "flex h-12 items-center justify-center rounded-lg border bg-background text-base font-medium hover:bg-muted sm:h-9 sm:text-sm";

const FIELD_ACTION_LABEL: Partial<Record<JobStatusValue, string>> = { IN_PROGRESS: "Start / resume", COMPLETED: "Mark complete", ON_HOLD: "Put on hold" };

export default async function MyDayPage() {
  const user = await requireBusinessPage(Access.MY_DAY);
  if (!hasAnyRole(user.roles, Access.FIELD)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My day" subtitle="This page is for technicians." />
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Technicians see their own jobs here. To see everyone&rsquo;s work, open the <Link className="underline" href="/schedule">Schedule</Link> or <Link className="underline" href="/jobs">Jobs</Link>.
          </CardContent>
        </Card>
      </div>
    );
  }
  const today = dayKey(new Date());
  const [jobs, visits] = await Promise.all([listJobsForTechnician(user.id, today, 8), listVisitsForTechnician(user.id, today, 8)]);
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const key = j.scheduledStart ? dayKey(j.scheduledStart) : today;
    byDay.set(key, [...(byDay.get(key) ?? []), j]);
  }
  const visitsByDay = new Map<string, typeof visits>();
  for (const v of visits) visitsByDay.set(dayKey(v.scheduledStart), [...(visitsByDay.get(dayKey(v.scheduledStart)) ?? []), v]);
  const days = [...new Set([...byDay.keys(), ...visitsByDay.keys()])].sort();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My day" subtitle={`Hi ${user.name?.split(" ")[0] ?? "there"} - today and the next 7 days.`} />
      {days.length === 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Nothing scheduled</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Nothing booked for you in the next week.</CardContent>
        </Card>
      ) : null}
      {days.map((day) => (
        <section key={day} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{day === today ? "Today" : formatDayKey(day)}</h2>
          {(visitsByDay.get(day) ?? []).map((v) => {
            const site = v.request.site;
            const address = site ? [site.line1, site.line2, `${site.suburb} ${site.state} ${site.postcode}`].filter(Boolean).join(", ") : null;
            const phone = v.request.client?.phone;
            return (
              <Card key={v.id} data-testid="field-visit" className="border-l-[6px] border-l-teal-accent">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>Site visit: {v.request.summary}</span>
                    <SiteVisitChip status={v.status} />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{formatDayTime(v.scheduledStart)} - {formatTime(v.scheduledEnd)}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  <div className="grid gap-1.5">
                    {v.request.client ? <p className="font-medium">{v.request.client.name}</p> : null}
                    {address ? <p>{address}</p> : null}
                    {site?.accessNotes ? <p><span className="text-xs text-muted-foreground">Access: </span>{site.accessNotes}</p> : null}
                    {site?.switchboardNotes ? <p><span className="text-xs text-muted-foreground">Switchboard: </span>{site.switchboardNotes}</p> : null}
                    {v.request.description ? <p className="whitespace-pre-wrap text-muted-foreground">{v.request.description}</p> : null}
                  </div>
                  {phone || address ? (
                    <div className="grid grid-cols-2 gap-2">
                      {phone ? <a className={TAP_LINK} href={`tel:${phone.replace(/\s/g, "")}`}>Call</a> : <span />}
                      {address ? <a className={TAP_LINK} href={`https://maps.google.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">Directions</a> : <span />}
                    </div>
                  ) : null}
                  {v.status === "SCHEDULED" ? (
                    <ActionForm action={fieldCompleteSiteVisitAction} submitLabel="Finish inspection" resetOnSuccess buttonClassName="h-12 w-full text-base sm:h-9 sm:w-auto sm:text-sm">
                      <input type="hidden" name="visitId" value={v.id} />
                      <TextAreaField label="What did you find? What will the job need?" name="findings" rows={4} placeholder="Old fuse board, 3 circuits to add, roof space accessible, needs 2 people..." />
                    </ActionForm>
                  ) : v.findings ? (
                    <p className="whitespace-pre-wrap rounded-md border p-3">{v.findings}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
          {(byDay.get(day) ?? []).map((j) => {
            const moves = JOB_TRANSITIONS[j.status].filter((to) => technicianCanMoveJob(j.status, to));
            const address = j.site ? [j.site.line1, j.site.line2, `${j.site.suburb} ${j.site.state} ${j.site.postcode}`].filter(Boolean).join(", ") : null;
            return (
              <Card key={j.id} data-testid="field-job" className={j.status === "IN_PROGRESS" ? "border-l-[6px] border-l-hivis" : undefined}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span className="flex flex-wrap items-center gap-2"><JobTag number={j.number} /><span>{j.title}</span></span>
                    <JobStatusChip status={j.status} />
                  </CardTitle>
                  {j.scheduledStart && j.scheduledEnd ? <p className="text-sm text-muted-foreground">{formatDayTime(j.scheduledStart)} - {formatTime(j.scheduledEnd)}</p> : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  <div className="grid gap-1.5">
                    <p className="font-medium">{j.client.name}</p>
                    {address ? <p>{address}</p> : null}
                    {j.site?.accessNotes ? <p><span className="text-xs text-muted-foreground">Access: </span>{j.site.accessNotes}</p> : null}
                    {j.site?.switchboardNotes ? <p><span className="text-xs text-muted-foreground">Switchboard: </span>{j.site.switchboardNotes}</p> : null}
                    {j.scope ? <p className="whitespace-pre-wrap text-muted-foreground">{j.scope}</p> : null}
                  </div>
                  {j.client.phone || address ? (
                    <div className="grid grid-cols-2 gap-2">
                      {j.client.phone ? <a className={TAP_LINK} href={`tel:${j.client.phone.replace(/\s/g, "")}`} data-testid="call-link">Call</a> : <span />}
                      {address ? <a className={TAP_LINK} href={`https://maps.google.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" data-testid="directions-link">Directions</a> : <span />}
                    </div>
                  ) : null}
                  {moves.length > 0 ? (
                    <div className="grid gap-2 sm:flex sm:flex-wrap">
                      {moves.map((to) => (
                        <ActionForm key={to} action={fieldChangeStatusAction} submitLabel={FIELD_ACTION_LABEL[to] ?? JOB_STATUS_LABEL[to]} variant={to === "COMPLETED" ? "default" : "outline"} className="gap-1" buttonClassName="h-12 w-full text-base sm:h-9 sm:w-auto sm:text-sm">
                          <input type="hidden" name="jobId" value={j.id} />
                          <input type="hidden" name="to" value={to} />
                        </ActionForm>
                      ))}
                    </div>
                  ) : null}
                  <details className="rounded-md border p-3">
                    <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium">Add a note or variation</summary>
                    <ActionForm action={fieldAddNoteAction} submitLabel="Add" resetOnSuccess variant="outline" className="mt-3" buttonClassName="h-12 w-full text-base sm:h-9 sm:w-auto sm:text-sm">
                    <input type="hidden" name="jobId" value={j.id} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <SelectField label="Add a" name="kind" options={[{ value: "NOTE", label: "Note" }, { value: "VARIATION", label: "Variation (extra work)" }]} />
                      <Field label="Extra ex GST ($)" name="extra" hint="Variations only" className="sm:col-span-2" />
                    </div>
                    <TextAreaField label="Details" name="text" rows={2} placeholder="Found old wiring, extra circuit needed..." />
                    </ActionForm>
                  </details>
                  {j.notes.length > 0 ? (
                    <ul className="flex flex-col gap-1.5 text-xs">
                      {j.notes.slice(0, 5).map((n) => (
                        <li key={n.id} className="rounded-md border p-2">
                          {n.kind === "VARIATION" ? <Badge variant="outline" className="mr-1">variation{n.approved ? " approved" : " pending"}</Badge> : null}
                          {n.text} <span className="text-muted-foreground">- {n.authorLabel}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
