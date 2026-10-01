import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { PageHeader } from "../../src/ui/fields";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await requireBusinessPage(Access.MY_DAY);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My day" subtitle={`Hi ${user.name?.split(" ")[0] ?? "there"} - your jobs for today and the next 7 days.`} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No jobs scheduled</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Scheduled jobs, with the address, phone and access notes, will appear here once quotes and jobs are built.
        </CardContent>
      </Card>
    </div>
  );
}
