"use server";

import { revalidatePath } from "next/cache";
import { stopQuoteChase } from "../automation";
import { answerQuoteByToken } from "../domain/quotes";
import { errorMessage, text, type ActionState } from "./shared";

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
