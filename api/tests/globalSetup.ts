import { execFileSync } from "node:child_process";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { env } from "../src/env";

const apiRoot = path.resolve(__dirname, "..");

export default async function setup() {
  if (env.NODE_ENV !== "test") throw new Error("Test setup must run with NODE_ENV=test");

  const testUrl = new URL(env.DATABASE_URL);
  const dbName = decodeURIComponent(testUrl.pathname.slice(1));

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(dbName)}`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(apiRoot, "drizzle") });
  } finally {
    await pool.end();
  }

  execFileSync(path.join(apiRoot, "node_modules/.bin/tsx"), ["src/db/seed.ts"], {
    cwd: apiRoot,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
