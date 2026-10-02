/**
 * Points the clients the automations will email at plus-aliases of one real inbox, so a demo's quote,
 * invoice, reminder and review emails land somewhere you can see (me+pat@gmail.com delivers to me@gmail.com).
 * Only clients tied to live work are touched; everyone else keeps their fictional address.
 * Set DEMO_INBOX in the environment to turn this on.
 */
import { appDb } from "../src/db/app";
import { normalizeEmail } from "../src/domain/clients/normalize";

export async function seedDemoInbox(inbox: string | undefined) {
  if (!inbox || !inbox.includes("@")) return { updated: 0 };
  const [local, domain] = inbox.trim().toLowerCase().split("@") as [string, string];
  const base = local.split("+")[0]!;
  const picks = await Promise.all([
    appDb.quote.findMany({ where: { status: "SENT" }, select: { clientId: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    appDb.invoice.findMany({ where: { status: { in: ["SENT", "PARTIALLY_PAID"] } }, select: { clientId: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    appDb.invoice.findMany({ where: { status: "PAID" }, select: { clientId: true }, orderBy: { createdAt: "desc" }, take: 2 }),
    appDb.invoice.findMany({ where: { status: "DRAFT" }, select: { clientId: true }, take: 1 }),
    appDb.job.findMany({ where: { status: "COMPLETED", invoices: { none: {} } }, select: { clientId: true }, take: 1 }),
  ]);
  const ids = [...new Set(picks.flat().map((r) => r.clientId))];
  let updated = 0;
  for (const id of ids) {
    const client = await appDb.client.findUnique({ where: { id }, select: { name: true } });
    if (!client) continue;
    const slug = client.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14) || "client";
    const email = `${base}+${slug}@${domain}`;
    await appDb.client.update({ where: { id }, data: { email, emailNorm: normalizeEmail(email), preferredContact: "EMAIL" } });
    updated++;
  }
  return { updated };
}
