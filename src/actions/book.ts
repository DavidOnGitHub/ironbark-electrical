"use server";

import { revalidatePath } from "next/cache";
import { BookingError, bookByLink } from "../domain/booking";
import { errorMessage, text, type ActionState } from "./shared";

/** The customer's choice of time from their link. Public on purpose (the customer has no account): the secret token in
 * the link is the only credential, and it only ever reaches that one enquiry. */
export async function bookByLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = text(formData, "token") ?? "";
  const start = text(formData, "start");
  if (!start) return { error: "Please choose a time." };
  try {
    await bookByLink(token, {
      start,
      name: text(formData, "name"),
      phone: text(formData, "phone"),
      address: { line1: text(formData, "line1"), line2: text(formData, "line2"), suburb: text(formData, "suburb"), state: text(formData, "state"), postcode: text(formData, "postcode"), accessNotes: text(formData, "accessNotes") },
    });
  } catch (err) {
    return { error: err instanceof BookingError ? err.message : errorMessage(err) };
  }
  revalidatePath(`/book/${token}`);
  for (const p of ["/requests", "/schedule", "/my-day", "/"]) revalidatePath(p);
  return { error: null, ok: true };
}
