import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const nodeEnv = process.env.NODE_ENV ?? "development";

const jwtSecret = process.env.JWT_SECRET || (nodeEnv === "test" ? "test-only-jwt-secret" : "");
if (!jwtSecret) throw new Error("JWT_SECRET is not set");

const rawSameSite = process.env.COOKIE_SAMESITE ?? "lax";
const cookieSameSite = (["lax", "strict", "none"] as const).find((v) => v === rawSameSite);
if (!cookieSameSite) {
  throw new Error(`COOKIE_SAMESITE must be lax, strict or none (got "${rawSameSite}")`);
}

export const env = {
  NODE_ENV: nodeEnv,
  API_PORT: Number(process.env.API_PORT) || 4000,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  JWT_SECRET: jwtSecret,
  COOKIE_SAMESITE: cookieSameSite,
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
};
