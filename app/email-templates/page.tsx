import Link from "next/link";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { listTemplates, templateUsage } from "../../src/domain/emailTemplates";
import { PageHeader } from "../../src/ui/fields";
import { Panel, Row, Rows } from "../../src/ui/kit";

export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage() {
  await requireBusinessPage(Access.TEMPLATES);
  const [templates, usage] = await Promise.all([listTemplates(), templateUsage()]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Email templates"
        subtitle="The wording and look of the emails your automations send. Pick a template in a workflow's email step."
        actions={<Button asChild><Link href="/email-templates/new">New template</Link></Button>}
      />
      <Panel title="Templates" count={templates.length}>
        <Rows empty="No templates yet.">
          {templates.map((t) => {
            const used = usage.get(t.key) ?? [];
            return (
              <Row
                key={t.id}
                href={`/email-templates/${t.id}`}
                title={t.name}
                meta={t.description ?? t.subject}
                side={<span className="text-[0.84rem] text-muted-foreground">{used.length ? `Used by ${used.join(", ")}` : "Not used yet"}</span>}
              />
            );
          })}
        </Rows>
      </Panel>
    </div>
  );
}
