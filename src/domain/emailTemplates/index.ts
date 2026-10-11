import { prisma } from "@kabosh-digital/workflow-schema";
import { appDb } from "../../db/app";
import { DEFAULT_TEMPLATES, LEGACY_QUOTE_TEMPLATES } from "./defaults";
import { findPlaceholders, renderEmail, slugKey, type Brand, type Variables } from "./render";

export * from "./render";
export { DEFAULT_TEMPLATES, LEGACY_QUOTE_TEMPLATES } from "./defaults";

export const STEP_KEY = "sendTemplatedEmail";

/** The business's sender identity on every email. */
export function emailBrand(): Brand {
  return { name: process.env.BRANDING_BUSINESS_NAME || "Ironbark Electrical", phone: "(02) 5550 0142" };
}

export class TemplateError extends Error {}

export interface TemplateInput {
  name: string;
  description?: string | null;
  subject: string;
  body: string;
}

function clean(input: TemplateInput) {
  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!name) throw new TemplateError("Give the template a name.");
  if (!subject) throw new TemplateError("The subject cannot be empty.");
  if (!body) throw new TemplateError("The message cannot be empty.");
  return { name, description: input.description?.trim() || null, subject, body, variables: findPlaceholders(subject, body) };
}

export async function listTemplates() {
  return appDb.emailTemplate.findMany({ orderBy: { name: "asc" } });
}

export const getTemplate = (id: string) => appDb.emailTemplate.findUnique({ where: { id } });
export const getTemplateByKey = (key: string) => appDb.emailTemplate.findUnique({ where: { key } });

/** Template keys, for the workflow builder's dropdown. */
export async function listTemplateOptions(): Promise<{ key: string; name: string }[]> {
  return appDb.emailTemplate.findMany({ select: { key: true, name: true }, orderBy: { name: "asc" } });
}

export async function createTemplate(input: TemplateInput) {
  const data = clean(input);
  const base = slugKey(data.name) || "template";
  let key = base;
  for (let n = 2; await getTemplateByKey(key); n++) key = `${base}_${n}`;
  return appDb.emailTemplate.create({ data: { key, ...data } });
}

/** The key never changes: workflows refer to it. */
export async function updateTemplate(id: string, input: TemplateInput) {
  return appDb.emailTemplate.update({ where: { id }, data: clean(input) });
}

/** Names of the workflows whose email steps use each template key. */
export async function templateUsage(): Promise<Map<string, string[]>> {
  const defs = await prisma.workflowDefinition.findMany({ select: { name: true, graph: true, publishedGraph: true } });
  const usage = new Map<string, Set<string>>();
  for (const d of defs) {
    for (const g of [d.graph, d.publishedGraph]) {
      const nodes = ((g as { nodes?: { stepKey?: string; config?: { template?: string } }[] } | null)?.nodes ?? []);
      for (const n of nodes) {
        if (n.stepKey === STEP_KEY && typeof n.config?.template === "string") {
          const set = usage.get(n.config.template) ?? new Set<string>();
          set.add(d.name);
          usage.set(n.config.template, set);
        }
      }
    }
  }
  return new Map([...usage].map(([k, v]) => [k, [...v].sort()]));
}

export async function deleteTemplate(id: string) {
  const t = await getTemplate(id);
  if (!t) return;
  const used = (await templateUsage()).get(t.key);
  if (used?.length) throw new TemplateError(`"${t.name}" is used by ${used.join(", ")}. Choose another template in those workflows first.`);
  await appDb.emailTemplate.delete({ where: { id } });
}

/** Creates any default template that does not exist yet; never touches ones the business has edited. */
export async function ensureDefaultTemplates(): Promise<number> {
  let created = 0;
  for (const d of DEFAULT_TEMPLATES) {
    const existing = await getTemplateByKey(d.key);
    if (existing) {
      // An untouched earlier default moves to the current wording; anything the business edited stays.
      const legacy = LEGACY_QUOTE_TEMPLATES[d.key]?.some((l) => l.subject === existing.subject && l.body === existing.body);
      if (legacy) await appDb.emailTemplate.update({ where: { id: existing.id }, data: { subject: d.subject, body: d.body, variables: findPlaceholders(d.subject, d.body) } });
      continue;
    }
    await appDb.emailTemplate.create({ data: { key: d.key, name: d.name, description: d.description, subject: d.subject, body: d.body, variables: findPlaceholders(d.subject, d.body) } });
    created++;
  }
  return created;
}

/** Sample values for the editor's preview: the default's own, else a visible marker per variable. */
export function sampleVariables(key: string, variables: string[]): Variables {
  const base = DEFAULT_TEMPLATES.find((d) => d.key === key)?.sample ?? {};
  return Object.fromEntries(variables.map((v) => [v, base[v] ?? `‹${v}›`]));
}

/** Renders a stored template. Throws when a variable has no value, so a half-filled email is never sent. */
export async function renderTemplate(key: string, vars: Variables) {
  const t = await getTemplateByKey(key);
  if (!t) throw new TemplateError(`Email template "${key}" does not exist. Pick one in the workflow's email step.`);
  const out = renderEmail(t, vars, emailBrand());
  if (out.missing.length) throw new TemplateError(`Email template "${t.name}" needs ${out.missing.map((m) => `{{${m}}}`).join(", ")} - map ${out.missing.length === 1 ? "it" : "them"} in the email step.`);
  return out;
}
