/** Matching keys. Emails compare case-insensitively; phones by digits only, with
 * Australian numbers brought to the national form (+61 4xx -> 04xx) so
 * "0412 345 678", "+61 412 345 678" and "0412345678" are the same person. */

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0061")) digits = digits.slice(4);
  else if (digits.startsWith("61") && digits.length >= 11) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  // A usable number has at least 8 digits after dropping the trunk prefix.
  if (digits.length < 8) return null;
  return `0${digits}`;
}

export type MatchKey = { emailNorm: string | null; phoneNorm: string | null };

export function matchKey(input: { email?: string | null; phone?: string | null }): MatchKey {
  return { emailNorm: normalizeEmail(input.email), phoneNorm: normalizePhone(input.phone) };
}

export type DuplicateReason = "email" | "phone";

/** Why `existing` looks like the same person as `candidate` (empty = no match). */
export function duplicateReasons(candidate: MatchKey, existing: MatchKey): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  if (candidate.emailNorm && candidate.emailNorm === existing.emailNorm) reasons.push("email");
  if (candidate.phoneNorm && candidate.phoneNorm === existing.phoneNorm) reasons.push("phone");
  return reasons;
}
