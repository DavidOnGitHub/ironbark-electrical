/**
 * Email to the Owner about the IT assistant, sent through Brevo's transactional API. Today there is one notice: the month's
 * budget for error and security fixes is used up. It is sent once per month: the first held request sends it and records that it did, so later held
 * requests (and the worker, which also starts requests) stay quiet. A failure is logged and never stops the caller; the
 * next held request tries again, because nothing is recorded until Brevo has accepted the email.
 *
 * Needs BREVO_API_KEY, IT_NOTIFY_EMAIL (who gets it) and IT_NOTIFY_FROM (a sender verified in Brevo). Without all three
 * nothing is sent.
 */
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { BudgetPause } from "./budget";

type Env = Record<string, string | undefined>;

const BREVO = "https://api.brevo.com/v3/smtp/email";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const notifyConfigured = (env: Env = process.env): boolean => Boolean(env.BREVO_API_KEY?.trim() && env.IT_NOTIFY_EMAIL && EMAIL.test(env.IT_NOTIFY_EMAIL.trim()) && env.IT_NOTIFY_FROM && EMAIL.test(env.IT_NOTIFY_FROM.trim()));

/** Sends one plain email. Returns whether Brevo accepted it. Never throws. */
export async function sendEmail(env: Env, mail: { subject: string; text: string }, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!notifyConfigured(env)) return false;
  try {
    const res = await fetchImpl(BREVO, {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY!.trim(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Ironbark IT assistant", email: env.IT_NOTIFY_FROM!.trim() }, to: [{ email: env.IT_NOTIFY_EMAIL!.trim() }], subject: mail.subject, textContent: mail.text }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[it-notify] Brevo answered ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[it-notify] could not reach Brevo", err instanceof Error ? err.message : err);
    return false;
  }
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Tells the Owner the fix budget is used up, once for the month. Returns whether an email was sent now. */
export async function notifyBudgetUsedUp(pause: BudgetPause, env: Env = process.env, opts: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  if (!notifyConfigured(env)) return false;
  const month = monthKey(pause.month);
  try {
    const already = await appDb.activityEvent.findFirst({ where: { entityType: "budget", entityId: month, kind: "BUDGET_NOTICE" }, select: { id: true } });
    if (already) return false;
    const sent = await sendEmail(
      env,
      {
        subject: "IT assistant: this month's budget for fixes is used up",
        text: [
          `This month's budget for the IT assistant's error and security fixes is used up: $${pause.spent.toFixed(2)} spent of $${pause.budget.toFixed(2)}.`,
          "",
          "New error fixes and security fixes are now held. Work already under way carries on, undoing a change that broke something still starts, and change requests are not affected (they use the month's credits).",
          "",
          "They start again next month, or as soon as you raise IT_FIX_MONTHLY_BUDGET_USD on the web service and the worker in Render. The IT page shows the usage.",
          "",
          "You will not get another email about this until next month.",
        ].join("\n"),
      },
      opts.fetchImpl,
    );
    if (!sent) return false;
    await appDb.$transaction((tx) => recordActivity(tx, { actor: { type: "SYSTEM", label: "IT assistant" }, entityType: "budget", entityId: month, kind: "BUDGET_NOTICE", summary: `Budget used up: the Owner was emailed ($${pause.spent.toFixed(2)} of $${pause.budget.toFixed(2)})` }));
    return true;
  } catch (err) {
    console.error("[it-notify] budget notice failed", err instanceof Error ? err.message : err);
    return false;
  }
}
