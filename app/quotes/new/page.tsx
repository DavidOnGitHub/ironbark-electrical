import Link from "next/link";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { getClient, listClients, formatSite } from "../../../src/domain/clients";
import { getRequest } from "../../../src/domain/requests";
import { createQuoteAction } from "../../../src/actions/quotes";
import { ActionForm } from "../../../src/ui/ActionForm";
import { PageHeader, SelectField, Field, TextAreaField } from "../../../src/ui/fields";

export const dynamic = "force-dynamic";

export default async function NewQuotePage(props: { searchParams: Promise<{ clientId?: string; requestId?: string; siteId?: string }> }) {
  await requireBusinessPage(Access.QUOTES_WRITE);
  const { clientId, requestId, siteId } = await props.searchParams;
  const request = requestId ? await getRequest(requestId) : null;
  const effectiveClientId = clientId ?? request?.clientId ?? undefined;
  const client = effectiveClientId ? await getClient(effectiveClientId) : null;

  if (!client) {
    const clients = await listClients({ limit: 300 });
    return (
      <div className="flex max-w-xl flex-col gap-5">
        <PageHeader title="New quote" subtitle="Who is it for?" />
        <Card>
          <CardContent>
            <form action="/quotes/new" className="flex flex-col gap-3">
              {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
              <SelectField label="Client" name="clientId" required options={[{ value: "", label: "Choose a client..." }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
              <div><Button type="submit">Continue</Button></div>
            </form>
            {request && !request.clientId ? (
              <p className="mt-3 text-sm text-muted-foreground">
                This enquiry is not linked to a client yet - <Link className="underline" href={`/requests/${request.id}`}>link or create one first</Link>.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="New quote" subtitle={`For ${client.name}`} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createQuoteAction} submitLabel="Create draft and add lines">
            <input type="hidden" name="clientId" value={client.id} />
            {request ? <input type="hidden" name="requestId" value={request.id} /> : null}
            <Field label="Title" name="title" required defaultValue={request?.summary ?? ""} placeholder="Install 6 LED downlights" />
            <SelectField
              label="Site"
              name="siteId"
              defaultValue={siteId ?? request?.siteId ?? client.sites[0]?.id ?? ""}
              options={[{ value: "", label: "No site" }, ...client.sites.map((s) => ({ value: s.id, label: formatSite(s) }))]}
            />
            <TextAreaField label="Notes for the customer" name="notes" rows={3} placeholder="Scope, exclusions, access arrangements..." />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
