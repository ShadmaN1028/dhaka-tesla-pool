import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const nodeEnv = process.env.NODE_ENV ?? "development";

const databaseUrl = nodeEnv === "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(`${nodeEnv === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
}
// Tests truncate tables, so under NODE_ENV=test only a database named *_test is accepted.
if (nodeEnv === "test" && !new URL(databaseUrl).pathname.slice(1).endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test");
}

const jwtSecret = process.env.JWT_SECRET || (nodeEnv === "test" ? "test-only-jwt-secret" : "");
if (!jwtSecret) throw new Error("JWT_SECRET is not set");

const rawSameSite = process.env.COOKIE_SAMESITE ?? "lax";
const cookieSameSite = (["lax", "strict", "none"] as const).find((v) => v === rawSameSite);
if (!cookieSameSite) {
  throw new Error(`COOKIE_SAMESITE must be lax, strict or none (got "${rawSameSite}")`);
}

export const env = {
  NODE_ENV: nodeEnv,
  DATABASE_URL: databaseUrl,
  API_PORT: Number(process.env.API_PORT) || 4000,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  JWT_SECRET: jwtSecret,
  COOKIE_SAMESITE: cookieSameSite,
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
};
