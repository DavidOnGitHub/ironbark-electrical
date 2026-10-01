import { execSync } from "node:child_process";

/** Integration tests run against their own schema ("iron-spark-test") in the
 * same database, so they can never touch the demo's data. */
export default function setup() {
  const base = process.env.APP_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/iron_spark?schema=iron-spark";
  const url = /schema=[^&]+/.test(base) ? base.replace(/schema=[^&]+/, "schema=iron-spark-test") : `${base}${base.includes("?") ? "&" : "?"}schema=iron-spark-test`;
  process.env.APP_DATABASE_URL = url;
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema.prisma", { env: { ...process.env, APP_DATABASE_URL: url }, stdio: "inherit" });
}
