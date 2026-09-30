import { defineConfig } from "vitest/config";

// Vitest keeps an existing NODE_ENV, so force it: env.ts then resolves TEST_DATABASE_URL.
process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
