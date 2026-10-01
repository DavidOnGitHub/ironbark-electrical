import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { listClients } from "../../../src/domain/clients";
import { createRequestAction } from "../../../src/actions/requests";
import { ActionForm } from "../../../src/ui/ActionForm";
import { PageHeader } from "../../../src/ui/fields";
import { RequestFields } from "../../../src/ui/RequestFields";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  await requireBusinessPage(Access.REQUESTS);
  const clients = await listClients({ limit: 300 });
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="New request" subtitle="Log a phone call or walk-in enquiry. Emails arrive on their own once the enquiry workflow is on." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What came in</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRequestAction} submitLabel="Log request">
            <RequestFields clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
