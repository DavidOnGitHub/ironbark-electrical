import { appDb } from "../src/db/app";

/** Empties every business table (the integration tests' own schema). */
export async function truncateAll() {
  await appDb.$executeRawUnsafe(
    'TRUNCATE TABLE "ActivityEvent","Payment","InvoiceLine","Invoice","JobNote","Job","QuoteLine","Quote","PriceItem","Sequence","Request","Site","Client" RESTART IDENTITY CASCADE',
  );
}
