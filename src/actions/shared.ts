import { ZodError } from "zod";
import type { DuplicateMatch } from "../domain/clients";

/** What a form action hands back to useActionState. */
export interface ActionState {
  error: string | null;
  /** Possible duplicate clients; the form shows them and offers "create anyway". */
  duplicates?: DuplicateMatch[];
  ok?: boolean;
  /** Shown instead of the form's fixed success text, when what happened depends on the outcome. */
  message?: string;
  /** A scheduling clash: the form offers "Book anyway". */
  conflict?: boolean;
}

export const initialActionState: ActionState = { error: null };

export function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? "Please check the form.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
