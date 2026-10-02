/**
 * Who the automations may email. The demo runs on real Gmail but must never write to a stranger, so
 * the default is DENY: with no list, nothing is sent automatically (the steps hand the job to a person).
 *
 * EMAIL_ALLOWLIST: comma-separated exact addresses and/or @domains; "*" allows everyone (a deliberate,
 * explicit choice for a real deployment). Gmail plus-tags are ignored when matching, so an allowed
 * "me@gmail.com" also allows "me+pat@gmail.com".
 */
const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/** Lower-cases and, for Gmail, drops "+tag" and dots in the local part: the address Google delivers to. */
export function canonicalEmail(address: string): string {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 1) return a;
  let local = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (GMAIL.has(domain)) {
    local = local.split("+")[0]!.replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return `${local.split("+")[0]}@${domain}`;
}

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Pulls the bare address out of "Name <a@b.c>". */
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1]! : from).trim().toLowerCase();
}

export function isAllowedRecipient(address: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = parseAllowlist(env.EMAIL_ALLOWLIST);
  if (list.length === 0 || !address) return false;
  if (list.includes("*")) return true;
  const email = canonicalEmail(bareAddress(address));
  const domain = email.slice(email.lastIndexOf("@"));
  return list.some((entry) => (entry.startsWith("@") ? entry === domain : canonicalEmail(entry) === email));
}

/** The Gmail plus-alias the inbox trigger listens on, e.g. "me+ironspark@gmail.com". */
export function inboxAlias(account: string, tag = "ironspark"): string {
  const a = account.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  return `${a.slice(0, at).split("+")[0]}+${tag}${a.slice(at)}`;
}
