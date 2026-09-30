import { inArray, notInArray, sql } from "drizzle-orm";
import request from "supertest";
import { app } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/session";
import { db } from "../src/db/client";
import { users } from "../src/db/schema";
import { env } from "../src/env";

export type SeededUser = "jashim" | "nusrat" | "rafiq" | "shirin";

const SEEDED_USERS: SeededUser[] = ["jashim", "nusrat", "rafiq", "shirin"];
const DEMO_PASSWORD = "tesla1234";
const emailOf = (name: SeededUser) => `${name}@teslapool.dev`;

export async function resetDb() {
  if (env.NODE_ENV !== "test") throw new Error("resetDb only runs against the test database");
  await db.execute(sql`TRUNCATE TABLE status_events, ride_requests, rides RESTART IDENTITY`);
  const seededEmails = SEEDED_USERS.map(emailOf);
  await db.delete(users).where(notInArray(users.email, seededEmails));
  await db.update(users).set({ isOnline: false }).where(inArray(users.email, seededEmails));
}

// Returns the "session=<jwt>" pair, ready for .set("Cookie", ...).
export async function loginAs(name: SeededUser): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: emailOf(name), password: DEMO_PASSWORD });
  if (res.status !== 200) throw new Error(`loginAs(${name}) failed: ${res.status} ${res.text}`);

  const cookie = res.get("Set-Cookie")?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error(`loginAs(${name}): no session cookie in the response`);
  return cookie.split(";")[0];
}
