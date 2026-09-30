import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";

export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool);

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
