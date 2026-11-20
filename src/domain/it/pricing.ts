/**
 * The price list for change requests: what each plan size costs in credits. Pure, with no database access, so the
 * pages can show prices too. The rules for charging are in credits.ts.
 */

/** Roughly what one credit is worth, in US dollars. Shown next to prices so a credit means something. */
export const CREDIT_USD = 10;

export type EstimateSize = "xs" | "s" | "m" | "l" | "xl";
export const ESTIMATE_SIZES: readonly EstimateSize[] = ["xs", "s", "m", "l", "xl"];

/** The price of each size. xl is null: it needs a developer's quote. */
export const CREDITS_BY_SIZE: Record<EstimateSize, number | null> = { xs: 1, s: 2, m: 4, l: 8, xl: null };

export const SIZE_LABEL: Record<EstimateSize, string> = { xs: "Extra small", s: "Small", m: "Medium", l: "Large", xl: "Extra large" };

export const isEstimateSize = (v: unknown): v is EstimateSize => typeof v === "string" && (ESTIMATE_SIZES as readonly string[]).includes(v);

/** The price for a size, or null when it cannot be priced here. */
export const creditsFor = (size: EstimateSize): number | null => CREDITS_BY_SIZE[size];

/** "2 credits (about $20)". */
export const creditText = (credits: number): string => `${credits} ${credits === 1 ? "credit" : "credits"} (about $${credits * CREDIT_USD})`;
