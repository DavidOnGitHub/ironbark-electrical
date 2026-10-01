import { appDb } from "../src/db/app";
import { prisma } from "@kabosh-digital/workflow-schema";
import { DEMO_PASSWORD, DEMO_USERS, seedBusiness, seedUsers } from "./seedData";
import { seedPriceList, seedQuotesAndJobs } from "./seedPhase2";
import { seedInvoicing } from "./seedInvoicing";

const existing = await appDb.client.count();
if (existing > 0) {
  console.log(`Business data already present (${existing} clients). Run "pnpm reset" to start over.`);
} else {
  const ids = await seedUsers();
  const counts = await seedBusiness(ids);
const items = await seedPriceList();
const phase2 = await seedQuotesAndJobs(ids, items);
const phase3 = await seedInvoicing(ids);
  console.log("Seeded:", counts, phase2, phase3);
  console.log(`Demo accounts (password ${DEMO_PASSWORD}): ${DEMO_USERS.map((u) => u.email).join(", ")}`);
}
await appDb.$disconnect();
await prisma.$disconnect();
