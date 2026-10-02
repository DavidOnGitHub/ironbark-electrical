"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { createTemplate, deleteTemplate, updateTemplate } from "../domain/emailTemplates";
import { errorMessage, text, type ActionState } from "./shared";

function fields(formData: FormData) {
  return { name: text(formData, "name") ?? "", description: text(formData, "description"), subject: text(formData, "subject") ?? "", body: text(formData, "body") ?? "" };
}

/** The layout lists the template keys for the workflow builder's dropdown, so refresh it after any change. */
const refresh = () => {
  revalidatePath("/email-templates");
  revalidatePath("/", "layout");
};

export async function saveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(Access.TEMPLATES);
  const id = text(formData, "templateId");
  let createdId: string | undefined;
  try {
    if (id) await updateTemplate(id, fields(formData));
    else createdId = (await createTemplate(fields(formData))).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  if (createdId) redirect(`/email-templates/${createdId}`);
  return { error: null, ok: true };
}

export async function deleteTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(Access.TEMPLATES);
  const id = text(formData, "templateId");
  if (!id) return { error: "Nothing to delete." };
  try {
    await deleteTemplate(id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/email-templates");
}
