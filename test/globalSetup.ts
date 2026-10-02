import { execSync } from "node:child_process";

/** Integration tests run against their own schema ("ironbark-electrical-test") in the
 * same database, so they can never touch the demo's data. */
export default function setup() {
  const base = process.env.APP_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ironbark_electrical?schema=ironbark-electrical";
  const url = /schema=[^&]+/.test(base) ? base.replace(/schema=[^&]+/, "schema=ironbark-electrical-test") : `${base}${base.includes("?") ? "&" : "?"}schema=ironbark-electrical-test`;
  process.env.APP_DATABASE_URL = url;
  // The platform tables (workflow definitions) live in the same database's public schema.
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ironbark_electrical?schema=public";
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema.prisma", { env: { ...process.env, APP_DATABASE_URL: url }, stdio: "inherit" });
}
