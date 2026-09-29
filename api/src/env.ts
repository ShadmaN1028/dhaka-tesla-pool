import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  API_PORT: Number(process.env.API_PORT) || 4000,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};
