import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { createClientAction } from "../../../src/actions/clients";
import { ActionForm } from "../../../src/ui/ActionForm";
import { ClientFields } from "../../../src/ui/ClientFields";
import { PageHeader } from "../../../src/ui/fields";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  await requireBusinessPage(Access.CLIENTS_WRITE);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="New client" subtitle="Add the person or company first; sites come next." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createClientAction} submitLabel="Create client">
            <ClientFields />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
