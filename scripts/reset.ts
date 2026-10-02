import { appDb } from "../src/db/app";
import { prisma } from "@kabosh-digital/workflow-schema";
import { DEMO_PASSWORD, DEMO_USERS, seedBusiness, seedUsers } from "./seedData";
import { seedPriceList, seedQuotesAndJobs } from "./seedPhase2";
import { seedInvoicing } from "./seedInvoicing";
import { seedDemoInbox } from "./seedDemoInbox";
import { clearAutomationRuns, seedWorkflows } from "./workflowSeed";

// Back to the seed state: stop any automation runs, wipe the business tables, re-create the demo accounts, reseed.
const runs = await clearAutomationRuns();
await appDb.$executeRawUnsafe('TRUNCATE TABLE "ironbark-electrical"."ActivityEvent", "ironbark-electrical"."Payment", "ironbark-electrical"."InvoiceLine", "ironbark-electrical"."Invoice", "ironbark-electrical"."JobNote", "ironbark-electrical"."Job", "ironbark-electrical"."QuoteLine", "ironbark-electrical"."Quote", "ironbark-electrical"."PriceItem", "ironbark-electrical"."Sequence", "ironbark-electrical"."Request", "ironbark-electrical"."Site", "ironbark-electrical"."Client" RESTART IDENTITY CASCADE');
const ids = await seedUsers();
const counts = await seedBusiness(ids);
const items = await seedPriceList();
const phase2 = await seedQuotesAndJobs(ids, items);
const phase3 = await seedInvoicing(ids);
const inbox = await seedDemoInbox(process.env.DEMO_INBOX);
await seedWorkflows(); // the four workflows, back to unpublished drafts
console.log("Reset and seeded:", counts, phase2, phase3, "| demo inbox clients:", inbox.updated, "| automation runs cleared:", runs);
console.log(`Demo accounts (password ${DEMO_PASSWORD}): ${DEMO_USERS.map((u) => u.email).join(", ")}`);
await appDb.$disconnect();
await prisma.$disconnect();
