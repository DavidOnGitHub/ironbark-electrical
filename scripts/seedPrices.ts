import { appDb } from "../src/db/app";
import { seedPriceList } from "./seedPhase2";

// Just the price list and bundles - for a database that already has your own clients and quotes,
// where "pnpm seed" (which only runs on an empty business) does nothing. Safe to run twice.
const existing = await appDb.priceItem.count();
if (existing > 0) {
  console.log(`The price list already has ${existing} items - nothing to do.`);
} else {
  const items = await seedPriceList();
  console.log(`Added ${items.size} price list items and the starter bundles.`);
}
await appDb.$disconnect();
