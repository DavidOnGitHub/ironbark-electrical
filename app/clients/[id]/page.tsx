import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { formatSite, getClient } from "../../../src/domain/clients";
import { listClientTimeline } from "../../../src/domain/activity";
import { formatAge, requestAgeHours } from "../../../src/domain/requests";
import { addNoteAction, addSiteAction, archiveClientAction, updateClientAction, updateSiteAction } from "../../../src/actions/clients";
import { ActionForm } from "../../../src/ui/ActionForm";
import { ClientFields, SiteFields } from "../../../src/ui/ClientFields";
import { PageHeader, TextAreaField } from "../../../src/ui/fields";
import { RequestStatusChip } from "../../../src/ui/chips";

export const dynamic = "force-dynamic";

export default async function ClientPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireBusinessPage(Access.CLIENTS_READ);
  const { id } = await props.params;
  const client = await getClient(id);
  if (!client) notFound();
  const timeline = await listClientTimeline(id);
  const canWrite = hasAnyRole(user.roles, Access.CLIENTS_WRITE);
  const canSeeRequests = hasAnyRole(user.roles, Access.REQUESTS);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/clients" className="text-sm text-muted-foreground hover:text-foreground">&larr; Clients</Link>
      <PageHeader
        title={client.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{client.type === "COMPANY" ? "Company" : "Person"}</span>
            {client.tags.map((t) => (
              <Badge key={t} variant="outline">{t}</Badge>
            ))}
            {client.archivedAt ? <Badge variant="secondary">archived</Badge> : null}
          </span>
        }
        actions={
          canWrite ? (
            <form action={archiveClientAction}>
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="archived" value={client.archivedAt ? "no" : "yes"} />
              <Button type="submit" variant="outline">{client.archivedAt ? "Restore" : "Archive"}</Button>
            </form>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <ActionForm action={updateClientAction} submitLabel="Save changes" successMessage="Saved.">
                  <input type="hidden" name="clientId" value={client.id} />
                  <ClientFields client={client} />
                </ActionForm>
              ) : (
                <dl className="grid gap-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{client.email ?? "-"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{client.phone ?? "-"}</dd></div>
                  {client.notes ? <div><dt className="text-xs text-muted-foreground">Notes</dt><dd>{client.notes}</dd></div> : null}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sites ({client.sites.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {client.sites.length === 0 ? <p className="text-sm text-muted-foreground">No sites yet.</p> : null}
              {client.sites.map((s) => (
                <details key={s.id} className="rounded-lg border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {s.label ? `${s.label} - ` : ""}
                    {formatSite(s)}
                  </summary>
                  <div className="mt-3">
                    {canWrite ? (
                      <ActionForm action={updateSiteAction} submitLabel="Save site" successMessage="Saved.">
                        <input type="hidden" name="siteId" value={s.id} />
                        <input type="hidden" name="clientId" value={client.id} />
                        <SiteFields site={s} />
                      </ActionForm>
                    ) : (
                      <dl className="grid gap-1">
                        {s.accessNotes ? <div><dt className="text-xs text-muted-foreground">Access</dt><dd>{s.accessNotes}</dd></div> : null}
                        {s.switchboardNotes ? <div><dt className="text-xs text-muted-foreground">Switchboard</dt><dd>{s.switchboardNotes}</dd></div> : null}
                      </dl>
                    )}
                  </div>
                </details>
              ))}
              {canWrite ? (
                <details className="rounded-lg border border-dashed p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Add a site</summary>
                  <div className="mt-3">
                    <ActionForm action={addSiteAction} submitLabel="Add site" successMessage="Site added." resetOnSuccess>
                      <input type="hidden" name="clientId" value={client.id} />
                      <SiteFields />
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {canSeeRequests ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Requests ({client.requests.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {client.requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : null}
                {client.requests.map((r) => (
                  <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-muted">
                    <span className="truncate font-medium">{r.summary}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <RequestStatusChip status={r.status} />
                      <span className="text-xs text-muted-foreground">{formatAge(requestAgeHours(r.receivedAt))}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canWrite ? (
              <ActionForm action={addNoteAction} submitLabel="Add note" resetOnSuccess variant="outline">
                <input type="hidden" name="clientId" value={client.id} />
                <TextAreaField label="Note" name="body" rows={2} placeholder="Called back, happy to proceed..." />
              </ActionForm>
            ) : null}
            <ol className="flex flex-col gap-3 text-sm">
              {timeline.map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p className={e.kind === "NOTE" ? "font-medium" : ""}>{e.summary}</p>
                  {e.body ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.body}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {e.actorLabel} - {formatRelativeTime(e.at)}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
