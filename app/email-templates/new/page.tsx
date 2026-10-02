import Link from "next/link";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { emailBrand } from "../../../src/domain/emailTemplates";
import { PageHeader } from "../../../src/ui/fields";
import { TemplateEditor } from "../../../src/ui/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireBusinessPage(Access.TEMPLATES);
  return (
    <div className="flex flex-col gap-5">
      <Link href="/email-templates" className="text-sm text-muted-foreground hover:text-foreground">&larr; Email templates</Link>
      <PageHeader title="New template" />
      <TemplateEditor initial={{ name: "", description: "", subject: "", body: "Hi {{name}},\n\n" }} sample={{}} brand={emailBrand()} />
    </div>
  );
}
