import { PrismaClient } from "iron-spark-client";

// One client per server process (Next dev reloads modules; a global avoids
// opening a new connection pool on every reload).
const globalForPrisma = globalThis as unknown as { __ironSparkPrisma?: PrismaClient };

export const appDb: PrismaClient = (globalForPrisma.__ironSparkPrisma ??= new PrismaClient());

export type { PrismaClient };
export { Prisma } from "iron-spark-client";

/** A client or an open transaction - what module functions run their queries on. */
import type { Prisma as PrismaNs, PrismaClient as PrismaClientT } from "iron-spark-client";
export type Db = PrismaClientT | PrismaNs.TransactionClient;
