import Link from "next/link";
import { notFound } from "next/navigation";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { deleteTemplateAction } from "../../../src/actions/emailTemplates";
import { emailBrand, getTemplate, sampleVariables, templateUsage } from "../../../src/domain/emailTemplates";
import { ActionForm } from "../../../src/ui/ActionForm";
import { PageHeader } from "../../../src/ui/fields";
import { TemplateEditor } from "../../../src/ui/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireBusinessPage(Access.TEMPLATES);
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t) notFound();
  const used = (await templateUsage()).get(t.key) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <Link href="/email-templates" className="text-sm text-muted-foreground hover:text-foreground">&larr; Email templates</Link>
      <PageHeader title={t.name} subtitle={used.length ? `Used by ${used.join(", ")}` : "Not used by any workflow yet"} />
      <TemplateEditor id={t.id} initial={{ name: t.name, description: t.description ?? "", subject: t.subject, body: t.body }} sample={sampleVariables(t.key, t.variables)} brand={emailBrand()} />
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Delete this template</summary>
        <ActionForm action={deleteTemplateAction} submitLabel="Delete template" variant="outline" className="mt-3">
          <input type="hidden" name="templateId" value={t.id} />
          <p className="text-muted-foreground">A template that a workflow uses cannot be deleted - choose another one in that workflow first.</p>
        </ActionForm>
      </details>
    </div>
  );
}
