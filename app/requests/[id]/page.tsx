import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { duplicateHintsForRequest, formatAge, getRequest, REQUEST_STATUS_LABEL, REQUEST_TRANSITIONS, requestAgeHours } from "../../../src/domain/requests";
import { formatSite, listClients } from "../../../src/domain/clients";
import { listQuotes } from "../../../src/domain/quotes";
import { formatMoney } from "../../../src/lib/money";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { QuoteStatusChip } from "../../../src/ui/chips";
import { listEntityTimeline } from "../../../src/domain/activity";
import { listStaff, listTechnicians, staffLabelMap } from "../../../src/domain/shared/staff";
import { listVisitsForRequest } from "../../../src/domain/siteVisits";
import { dateToSydneyLocal, formatDayTime, formatTime, tomorrowLocalPrefix } from "../../../src/lib/tz";
import {
  assignRequestOwnerAction,
  changeRequestStatusAction,
  createClientFromRequestAction,
  linkRequestClientAction,
} from "../../../src/actions/requests";
import { bookSiteVisitAction, cancelSiteVisitAction, completeSiteVisitAction } from "../../../src/actions/siteVisits";
import { ActionForm } from "../../../src/ui/ActionForm";
import { Field, PageHeader, SelectField, TextAreaField } from "../../../src/ui/fields";
import { CATEGORY_LABEL, RequestStatusChip, SiteVisitChip, SOURCE_LABEL, UrgencyChip } from "../../../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function RequestPage(props: { params: Promise<{ id: string }> }) {
  await requireBusinessPage(Access.REQUESTS);
  const { id } = await props.params;
  const request = await getRequest(id);
  if (!request) notFound();
  const quotes = await listQuotes({ requestId: id });
  const [timeline, staff, labels, hints, clients, visits, technicians] = await Promise.all([
    listEntityTimeline("request", id),
    listStaff(),
    staffLabelMap(),
    duplicateHintsForRequest(request),
    request.clientId ? Promise.resolve([]) : listClients({ limit: 300 }),
    listVisitsForRequest(id),
    listTechnicians(),
  ]);
  const nextStatuses = REQUEST_TRANSITIONS[request.status];
  const booked = visits.find((v) => v.status === "SCHEDULED");
  const done = visits.find((v) => v.status === "COMPLETED");
  const canBook = !!request.clientId && ["NEW", "CONTACTED", "SITE_VISIT_BOOKED"].includes(request.status);
  const tomorrow = tomorrowLocalPrefix();

  return (
    <div className="flex flex-col gap-5">
      <Link href="/requests" className="text-sm text-muted-foreground hover:text-foreground">&larr; Requests</Link>
      <PageHeader
        title={request.summary}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <RequestStatusChip status={request.status} />
            <UrgencyChip urgency={request.urgency} />
            <span>
              {CATEGORY_LABEL[request.category]} - via {SOURCE_LABEL[request.source]} - received {formatRelativeTime(request.receivedAt)} ({formatAge(requestAgeHours(request.receivedAt))} ago)
            </span>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The enquiry</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {request.description ? <p className="whitespace-pre-wrap">{request.description}</p> : <p className="text-muted-foreground">No details recorded.</p>}
              {request.status === "LOST" && request.lostReason ? <p className="text-red-700 dark:text-red-400">Lost: {request.lostReason}</p> : null}
              <dl className="grid gap-1 text-xs text-muted-foreground">
                {request.contactName ? <div>Contact: {request.contactName}</div> : null}
                {request.contactEmail ? <div>Email: {request.contactEmail}</div> : null}
                {request.contactPhone ? <div>Phone: {request.contactPhone}</div> : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {request.client ? (
                <p>
                  <Link href={`/clients/${request.client.id}`} className="font-medium underline">{request.client.name}</Link>
                  {request.site ? <span className="text-muted-foreground"> - {formatSite(request.site)}</span> : null}
                </p>
              ) : (
                <>
                  {hints.length > 0 ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      <p className="font-medium">This enquirer may already be a client:</p>
                      <ul className="mt-1 list-disc pl-5">
                        {hints.map((h) => (
                          <li key={h.client.id}>
                            <Link href={`/clients/${h.client.id}`} className="underline">{h.client.name}</Link> <span className="text-xs">(same {h.reasons.join(" and ")})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <ActionForm action={linkRequestClientAction} submitLabel="Link to client" variant="outline" successMessage="Linked.">
                    <input type="hidden" name="requestId" value={request.id} />
                    <SelectField
                      label="Existing client"
                      name="clientId"
                      required
                      defaultValue={hints[0]?.client.id ?? ""}
                      options={[{ value: "", label: "Choose..." }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                    />
                  </ActionForm>
                  <ActionForm action={createClientFromRequestAction} submitLabel="Create a client from this enquiry" variant="outline">
                    <input type="hidden" name="requestId" value={request.id} />
                  </ActionForm>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Site inspection</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm" data-testid="site-inspection">
              {visits.length === 0 && ["QUOTE_REQUEST", "NEW_INSTALL"].includes(request.category) ? (
                <p className="text-muted-foreground">Jobs like this are usually quoted after a look on site. Book an electrician to inspect first, or quote straight away if it is simple.</p>
              ) : null}
              {visits.length === 0 && !["QUOTE_REQUEST", "NEW_INSTALL"].includes(request.category) ? <p className="text-muted-foreground">No site visit booked.</p> : null}
              {visits.map((v) => (
                <div key={v.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{formatDayTime(v.scheduledStart)} - {formatTime(v.scheduledEnd)}</span>
                    <SiteVisitChip status={v.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{labels.get(v.assignedUserId) ?? "Technician"}</p>
                  {v.findings ? <p className="whitespace-pre-wrap">{v.findings}</p> : null}
                  {v.status === "SCHEDULED" ? (
                    <>
                      <ActionForm action={completeSiteVisitAction} submitLabel="Record findings" successMessage="Visit recorded.">
                        <input type="hidden" name="visitId" value={v.id} />
                        <TextAreaField label="What was found (the technician usually does this from their phone)" name="findings" rows={3} placeholder="Old rewireable fuses, 3 circuits to add, ceiling space is accessible..." />
                      </ActionForm>
                      <ActionForm action={cancelSiteVisitAction} submitLabel="Cancel visit" variant="outline">
                        <input type="hidden" name="visitId" value={v.id} />
                      </ActionForm>
                    </>
                  ) : null}
                </div>
              ))}
              {canBook && !done ? (
                <ActionForm action={bookSiteVisitAction} submitLabel={booked ? "Move the visit" : "Book a site visit"} successMessage="Booked.">
                  <input type="hidden" name="requestId" value={request.id} />
                  <SelectField
                    label="Technician"
                    name="assignedUserId"
                    required
                    defaultValue={booked?.assignedUserId ?? ""}
                    options={[{ value: "", label: "Choose..." }, ...technicians.map((t) => ({ value: t.id, label: t.name?.trim() || t.email }))]}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Start" name="start" type="datetime-local" required defaultValue={booked ? dateToSydneyLocal(booked.scheduledStart) : `${tomorrow}09:00`} />
                    <Field label="End" name="end" type="datetime-local" required defaultValue={booked ? dateToSydneyLocal(booked.scheduledEnd) : `${tomorrow}10:00`} />
                  </div>
                  <p className="text-xs text-muted-foreground">Times are Sydney time.</p>
                </ActionForm>
              ) : null}
              {!request.clientId && ["NEW", "CONTACTED"].includes(request.status) ? <p className="text-xs text-muted-foreground">Link this enquiry to a client first, then book the visit.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quote</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {quotes.map((q) => (
                <Link key={q.id} href={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 hover:bg-muted">
                  <span><span className="font-medium">{q.number}</span> {q.title}</span>
                  <span className="flex items-center gap-2"><QuoteStatusChip status={q.effectiveStatus} /><span className="tabular-nums text-xs">{formatMoney(q.totalCents)}</span></span>
                </Link>
              ))}
              {quotes.length === 0 ? <p className="text-muted-foreground">No quote yet.</p> : null}
              {request.clientId ? (
                <div className="flex flex-col gap-2">
                  {booked ? <p className="text-xs text-muted-foreground">The site visit has not been done yet - its findings will not be in the quote.</p> : null}
                  <div><Button asChild variant="outline"><Link href={`/quotes/new?requestId=${request.id}`}>{done ? "Create a quote from the visit" : "Create a quote"}</Link></Button></div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Link this enquiry to a client first, then create the quote.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Follow-up</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {nextStatuses.length > 0 ? (
                <ActionForm action={changeRequestStatusAction} submitLabel="Update status" successMessage="Status updated.">
                  <input type="hidden" name="requestId" value={request.id} />
                  <SelectField label="Move to" name="to" required options={nextStatuses.map((s) => ({ value: s, label: REQUEST_STATUS_LABEL[s] }))} defaultValue={nextStatuses[0]} />
                  <Field label="If lost, why?" name="lostReason" placeholder="Chose another electrician, price, not proceeding..." />
                </ActionForm>
              ) : (
                <p className="text-sm text-muted-foreground">This request is closed as {REQUEST_STATUS_LABEL[request.status].toLowerCase()}.</p>
              )}
              <ActionForm action={assignRequestOwnerAction} submitLabel="Assign" variant="outline" successMessage="Assigned.">
                <input type="hidden" name="requestId" value={request.id} />
                <SelectField
                  label={`Owner (now: ${request.ownerUserId ? (labels.get(request.ownerUserId) ?? "unknown") : "unassigned"})`}
                  name="ownerUserId"
                  defaultValue={request.ownerUserId ?? ""}
                  options={[{ value: "", label: "Unassigned" }, ...staff.map((u) => ({ value: u.id, label: u.name?.trim() || u.email }))]}
                />
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3 text-sm">
                {timeline.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3">
                    <p>{e.summary}</p>
                    {e.body ? <p className="text-muted-foreground">{e.body}</p> : null}
                    <p className="text-xs text-muted-foreground">{e.actorLabel} - {formatRelativeTime(e.at)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
