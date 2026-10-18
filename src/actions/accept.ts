"use server";

import { revalidatePath } from "next/cache";
import { afterJobSlotChosen, stopQuoteChase } from "../automation";
import { BookingError, holdJobByLink } from "../domain/booking";
import { answerQuoteByToken } from "../domain/quotes";
import { errorMessage, text, type ActionState } from "./shared";

/** The customer's choice of day for their job, from the same link. Public on purpose: the secret token is the only credential and
 * it only ever reaches that one quote's job. The first pick asks the office to approve it; the time is held meanwhile. */
export async function chooseJobSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = text(formData, "token") ?? "";
  const start = text(formData, "start");
  if (!start) return { error: "Please choose a time." };
  try {
    const { job, fresh } = await holdJobByLink(token, start);
    if (fresh) await afterJobSlotChosen(job.id); // the booking approval (if published); a failure never undoes the customer's choice
  } catch (err) {
    return { error: err instanceof BookingError ? err.message : errorMessage(err) };
  }
  revalidatePath(`/accept/${token}`);
  for (const p of ["/jobs", "/schedule", "/tasks", "/"]) revalidatePath(p);
  return { error: null, ok: true };
}

/** The customer's answer from their link. Public on purpose (the customer has no account): the secret
 * token in the link is the only credential, and it only ever reaches that one quote. */
export async function answerQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = text(formData, "token") ?? "";
  const decision = text(formData, "decision");
  if (decision !== "APPROVED" && decision !== "DECLINED") return { error: "Choose accept or decline." };
  try {
    const { quote } = await answerQuoteByToken(token, decision, text(formData, "reason"));
    await stopQuoteChase(quote.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/accept/${token}`);
  for (const p of ["/quotes", "/requests", "/jobs", "/"]) revalidatePath(p);
  return { error: null, ok: true };
}
