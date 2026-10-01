import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // The integration tests share one database schema: run files one at a time.
    fileParallelism: false,
  },
});
