import { appDb } from "../src/db/app";
import { prisma } from "@kabosh-digital/workflow-schema";
import { DEMO_PASSWORD, DEMO_USERS, seedBusiness, seedUsers } from "./seedData";
import { seedPriceList, seedQuotesAndJobs } from "./seedPhase2";
import { seedInvoicing } from "./seedInvoicing";
import { clearAutomationRuns, seedWorkflows } from "./workflowSeed";

// Back to the seed state: stop any automation runs, wipe the business tables, re-create the demo accounts, reseed.
const runs = await clearAutomationRuns();
await appDb.$executeRawUnsafe('TRUNCATE TABLE "iron-spark"."ActivityEvent", "iron-spark"."Payment", "iron-spark"."InvoiceLine", "iron-spark"."Invoice", "iron-spark"."JobNote", "iron-spark"."Job", "iron-spark"."QuoteLine", "iron-spark"."Quote", "iron-spark"."PriceItem", "iron-spark"."Sequence", "iron-spark"."Request", "iron-spark"."Site", "iron-spark"."Client" RESTART IDENTITY CASCADE');
const ids = await seedUsers();
const counts = await seedBusiness(ids);
const items = await seedPriceList();
const phase2 = await seedQuotesAndJobs(ids, items);
const phase3 = await seedInvoicing(ids);
await seedWorkflows(); // the four workflows, back to unpublished drafts
console.log("Reset and seeded:", counts, phase2, phase3, "| automation runs cleared:", runs);
console.log(`Demo accounts (password ${DEMO_PASSWORD}): ${DEMO_USERS.map((u) => u.email).join(", ")}`);
await appDb.$disconnect();
await prisma.$disconnect();
