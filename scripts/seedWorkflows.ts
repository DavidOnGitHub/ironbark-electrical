/**
 * Puts Ironbark Electrical's four workflows into the platform's tables (as drafts the owner can edit, test
 * and publish in the console), wiring the Gmail connector if one is connected.
 *
 *   pnpm workflows:seed            drafts
 *   pnpm workflows:seed --publish  also publish them (they then run for real - only with Gmail connected)
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { seedWorkflows } from "./workflowSeed";

const { done, gmailConnected } = await seedWorkflows({ publish: process.argv.includes("--publish") });
for (const w of done) console.log(`${w.published ? "published" : "draft    "}  ${w.name}`);
if (!gmailConnected) console.log("No Gmail connected yet - connect one in the console (Connected apps), then run this again to wire it in.");
await prisma.$disconnect();
