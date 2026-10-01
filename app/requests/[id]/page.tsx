import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { duplicateHintsForRequest, formatAge, getRequest, REQUEST_STATUS_LABEL, REQUEST_TRANSITIONS, requestAgeHours } from "../../../src/domain/requests";
import { formatSite, listClients } from "../../../src/domain/clients";
import { listEntityTimeline } from "../../../src/domain/activity";
import { listStaff, staffLabelMap } from "../../../src/domain/shared/staff";
import {
  assignRequestOwnerAction,
  changeRequestStatusAction,
  createClientFromRequestAction,
  linkRequestClientAction,
} from "../../../src/actions/requests";
import { ActionForm } from "../../../src/ui/ActionForm";
import { Field, PageHeader, SelectField } from "../../../src/ui/fields";
import { CATEGORY_LABEL, RequestStatusChip, SOURCE_LABEL, UrgencyChip } from "../../../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function RequestPage(props: { params: Promise<{ id: string }> }) {
  await requireBusinessPage(Access.REQUESTS);
  const { id } = await props.params;
  const request = await getRequest(id);
  if (!request) notFound();
  const [timeline, staff, labels, hints, clients] = await Promise.all([
    listEntityTimeline("request", id),
    listStaff(),
    staffLabelMap(),
    duplicateHintsForRequest(request),
    request.clientId ? Promise.resolve([]) : listClients({ limit: 300 }),
  ]);
  const nextStatuses = REQUEST_TRANSITIONS[request.status];

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
