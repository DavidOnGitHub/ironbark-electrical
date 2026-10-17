import { appDb } from "../src/db/app";

/** Empties every business table (the integration tests' own schema). */
export async function truncateAll() {
  await appDb.$executeRawUnsafe(
    'TRUNCATE TABLE "ActivityEvent","Payment","InvoiceLine","Invoice","JobNote","Job","QuoteLine","Quote","PriceItem","Sequence","SiteVisit","Request","Site","Client","EmailTemplate","PriceBundleItem","PriceBundle" RESTART IDENTITY CASCADE',
  );
}
