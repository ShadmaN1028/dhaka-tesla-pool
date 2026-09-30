import { eq, inArray, notInArray, sql } from "drizzle-orm";
import request from "supertest";
import { app } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/session";
import { db } from "../src/db/client";
import { areas, rideRequests, rides, users, vehicles } from "../src/db/schema";
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

export async function areaId(name: string): Promise<number> {
  const [area] = await db.select({ id: areas.id }).from(areas).where(eq(areas.name, name));
  if (!area) throw new Error(`areaId: no seeded area named ${name}`);
  return area.id;
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

type RequestStatus = (typeof rideRequests.$inferSelect)["status"];
type RideStatus = (typeof rides.$inferSelect)["status"];

export async function requestRide(cookie: string, pickup: string, destination: string, seats = 1) {
  return request(app)
    .post("/requests")
    .set("Cookie", cookie)
    .send({
      pickup_area_id: await areaId(pickup),
      destination_area_id: await areaId(destination),
      seats,
    });
}

// Matching is not built yet, so pool membership is set up directly in the test database.
export async function bulletRide(seatsOccupied: number, status: RideStatus = "OPEN") {
  const [bullet] = await db.select().from(vehicles).where(eq(vehicles.name, "Bullet"));
  const [ride] = await db
    .insert(rides)
    .values({
      vehicleId: bullet.id,
      pickupAreaId: await areaId("Banani"),
      capacity: bullet.capacity,
      seatsOccupied,
      status,
    })
    .returning();
  return ride;
}

export async function setStatus(requestId: string, status: RequestStatus, rideId?: string) {
  await db
    .update(rideRequests)
    .set({ status, ...(rideId ? { rideId } : {}) })
    .where(eq(rideRequests.id, requestId));
}

export async function rideOf(rideId: string) {
  const [ride] = await db.select().from(rides).where(eq(rides.id, rideId));
  return ride;
}

export async function requestOf(requestId: string) {
  const [row] = await db.select().from(rideRequests).where(eq(rideRequests.id, requestId));
  return row;
}

// Resolves once some backend is blocked waiting for a row lock; used to order concurrent transactions.
export async function waitForLockWait() {
  for (let i = 0; i < 150; i++) {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitForLockWait: nothing ever blocked on a lock");
}
