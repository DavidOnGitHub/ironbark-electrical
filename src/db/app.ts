import { PrismaClient } from "ironbark-electrical-client";

// One client per server process (Next dev reloads modules; a global avoids
// opening a new connection pool on every reload).
const globalForPrisma = globalThis as unknown as { __ironSparkPrisma?: PrismaClient };

export const appDb: PrismaClient = (globalForPrisma.__ironSparkPrisma ??= new PrismaClient());

export type { PrismaClient };
export { Prisma } from "ironbark-electrical-client";

/** A client or an open transaction - what module functions run their queries on. */
import type { Prisma as PrismaNs, PrismaClient as PrismaClientT } from "ironbark-electrical-client";
export type Db = PrismaClientT | PrismaNs.TransactionClient;
