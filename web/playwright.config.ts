import { defineConfig } from "@playwright/test";

// Needs Postgres up (docker compose up -d db) and a seeded database. Servers that are already
// running are reused; otherwise the API starts in dev mode and the web app as a production build.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./node_modules/.cache/e2e-results",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "npm run dev",
      cwd: "../api",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000/login",
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
