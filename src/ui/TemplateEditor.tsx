"use client";

import { useMemo, useState } from "react";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { Label } from "@kabosh-digital/m-street-kit/ui/label";
import { Textarea } from "@kabosh-digital/m-street-kit/ui/textarea";
import { saveTemplateAction } from "../actions/emailTemplates";
import { findPlaceholders, renderEmail, type Variables } from "../domain/emailTemplates/render";
import { ActionForm } from "./ActionForm";

/** Edit a template next to a live preview of the real email (rendered with sample values). */
export function TemplateEditor({
  id,
  initial,
  sample,
  brand,
}: {
  id?: string;
  initial: { name: string; description: string; subject: string; body: string };
  sample: Variables;
  brand: { name: string; phone?: string };
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const variables = useMemo(() => findPlaceholders(subject, body), [subject, body]);
  const preview = useMemo(() => {
    const vars: Variables = Object.fromEntries(variables.map((v) => [v, sample[v] ?? `‹${v}›`]));
    return renderEmail({ subject, body }, vars, brand);
  }, [subject, body, variables, sample, brand]);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ActionForm action={saveTemplateAction} submitLabel={id ? "Save template" : "Create template"} successMessage="Saved.">
        {id ? <input type="hidden" name="templateId" value={id} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t-name">Name</Label>
          <Input id="t-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required className="bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t-desc">What it is for</Label>
          <Input id="t-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} className="bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t-subject">Subject</Label>
          <Input id="t-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required className="bg-card" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t-body">Message</Label>
          <Textarea id="t-body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} required className="bg-card font-mono text-sm" />
          <p className="text-xs text-muted-foreground">
            Blank line = new paragraph. <code>- </code> starts a bullet. <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://link)</code>. A line that is only a link becomes a button.
            Put <code>{"{{name}}"}</code> where a value belongs; the workflow&rsquo;s email step fills it in.
          </p>
        </div>
        <div className="text-sm" data-testid="variables">
          <span className="font-semibold">Variables in this template: </span>
          {variables.length === 0 ? <span className="text-muted-foreground">none</span> : variables.map((v) => <code key={v} className="mr-1.5 rounded bg-muted px-1.5 py-0.5">{`{{${v}}}`}</code>)}
        </div>
      </ActionForm>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Preview <span className="font-normal text-muted-foreground">(sample values)</span></p>
        <div className="rounded-md border bg-card p-3 text-sm">
          <span className="text-muted-foreground">Subject: </span>
          <span data-testid="preview-subject">{preview.subject}</span>
        </div>
        <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[34rem] w-full rounded-md border bg-white" data-testid="preview-frame" />
      </div>
    </div>
  );
}
