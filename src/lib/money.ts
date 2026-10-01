/** Money is integer cents everywhere; these convert at the edges only. */

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatMoney(cents: number): string {
  return AUD.format(cents / 100);
}

/** "85", "85.5", "$1,200.00" -> cents. Returns null when it is not a money amount. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** 12345 -> "123.45" (for form inputs). */
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
