import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db } from "../src/db/client";
import { rides, statusEvents, users } from "../src/db/schema";
import {
  bulletRide,
  loginAs,
  requestOf,
  requestRide,
  resetDb,
  rideOf,
  type SeededUser,
} from "./helpers";

const post = (cookie: string, path: string) => request(app).post(path).set("Cookie", cookie);
const get = (cookie: string, path: string) => request(app).get(path).set("Cookie", cookie);

// Seeded users survive resetDb, so one login per user is enough for the whole file.
const cookies = new Map<SeededUser, string>();
async function session(name: SeededUser) {
  let cookie = cookies.get(name);
  if (!cookie) {
    cookie = await loginAs(name);
    cookies.set(name, cookie);
  }
  return cookie;
}

const ageRide = (rideId: string, minutes: number) =>
  db
    .update(rides)
    .set({ createdAt: sql`now() - make_interval(mins => ${minutes})` })
    .where(eq(rides.id, rideId));

const allRides = () => db.select().from(rides);

describe("a new request joins a compatible ride", () => {
  it("Nusrat is accepted, Rafiq joins her ride, and the pooled fares are 6800 and 5600", async () => {
    const nusrat = await session("nusrat");
    const rafiq = await session("rafiq");
    const jashim = await session("jashim");

    const first = await requestRide(nusrat, "Banani", "Mohakhali");
    expect(first.body).toMatchObject({ status: "REQUESTED", ride_id: null });
    await post(jashim, "/driver/online");
    const accepted = await post(jashim, `/driver/requests/${first.body.id}/accept`);
    expect(accepted.status).toBe(200);
    const rideId: string = accepted.body.id;

    const second = await requestRide(rafiq, "Banani", "Gulshan 1");
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      status: "MATCHED",
      ride_id: rideId,
      estimated_fare_paisa: 7000,
      final_fare_paisa: null,
      driver: { name: "Jashim", vehicle: "Bullet" },
    });
    expect((await rideOf(rideId)).seatsOccupied).toBe(2);

    const [rafiqRow] = await db.select().from(users).where(eq(users.email, "rafiq@teslapool.dev"));
    const events = await db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.entityId, second.body.id))
      .orderBy(statusEvents.id);
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "REQUESTED"],
      ["REQUESTED", "MATCHED"],
    ]);
    expect(events.every((e) => e.actorUserId === rafiqRow.id)).toBe(true);

    const driverView = await get(jashim, "/driver/ride");
    expect(driverView.body.seats_occupied).toBe(2);
    expect(driverView.body.passengers.map((p: { passenger_name: string }) => p.passenger_name)).toEqual([
      "Nusrat",
      "Rafiq",
    ]);

    for (const step of ["arrive", "start", "complete"]) {
      expect((await post(jashim, `/driver/ride/${step}`)).status).toBe(200);
    }
    expect(await requestOf(first.body.id)).toMatchObject({ status: "COMPLETED", finalFarePaisa: 6800 });
    expect(await requestOf(second.body.id)).toMatchObject({ status: "COMPLETED", finalFarePaisa: 5600 });

    const nusratsList = await get(nusrat, "/requests");
    expect(nusratsList.body.map((r: { id: string }) => r.id)).toEqual([first.body.id]);
    expect(nusratsList.body[0].final_fare_paisa).toBe(6800);
    expect(JSON.stringify(nusratsList.body)).not.toMatch(new RegExp(`${second.body.id}|Rafiq|5600`));

    const rafiqsList = await get(rafiq, "/requests");
    expect(rafiqsList.body.map((r: { id: string }) => r.id)).toEqual([second.body.id]);
    expect(rafiqsList.body[0].final_fare_paisa).toBe(5600);
    expect(JSON.stringify(rafiqsList.body)).not.toMatch(new RegExp(`${first.body.id}|Nusrat|6800`));
  });

  it.each(["OPEN", "DRIVER_ARRIVED"] as const)("joins a %s ride", async (status) => {
    const ride = await bulletRide(1, status);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1");

    expect(res.body).toMatchObject({ status: "MATCHED", ride_id: ride.id });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(2);
  });

  it("a request that exactly fills the last free seats joins (1 seat left, 1 seat asked)", async () => {
    const ride = await bulletRide(2);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1", 1);

    expect(res.body).toMatchObject({ status: "MATCHED", ride_id: ride.id });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(3);
  });

  it("a ride created 9 minutes ago still takes passengers", async () => {
    const ride = await bulletRide(1);
    await ageRide(ride.id, 9);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1");

    expect(res.body).toMatchObject({ status: "MATCHED", ride_id: ride.id });
  });
});

describe("a new request does not join an unsuitable ride", () => {
  it("from a different pickup area (Mirpur)", async () => {
    const ride = await bulletRide(1);

    const res = await requestRide(await session("rafiq"), "Mirpur", "Banani");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "REQUESTED", ride_id: null });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
  });

  it("when the ride was created more than 10 minutes ago", async () => {
    const ride = await bulletRide(1);
    await ageRide(ride.id, 11);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1");

    expect(res.body).toMatchObject({ status: "REQUESTED", ride_id: null });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
  });

  it.each(["STARTED", "COMPLETED", "CANCELLED"] as const)("when the ride is %s", async (status) => {
    const ride = await bulletRide(1, status);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1");

    expect(res.body).toMatchObject({ status: "REQUESTED", ride_id: null });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
  });

  it("when Rafiq asks for 2 seats and only 1 is free: he stays REQUESTED and nothing is claimed", async () => {
    const ride = await bulletRide(2);

    const res = await requestRide(await session("rafiq"), "Banani", "Gulshan 1", 2);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "REQUESTED", ride_id: null });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(2);
  });

  it("a rejected duplicate request rolls back its seat claim", async () => {
    const nusrat = await session("nusrat");
    expect((await requestRide(nusrat, "Banani", "Mohakhali")).body.status).toBe("REQUESTED");
    const ride = await bulletRide(1); // created after her request, so she is not on it

    const again = await requestRide(nusrat, "Banani", "Gulshan 1");

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ACTIVE_REQUEST_EXISTS");
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
  });
});

describe("the last seat", () => {
  it("Nusrat and Shirin request at the same time with 1 seat left: exactly one is MATCHED, the ride ends with exactly 3 seats, 10 times", async () => {
    const nusrat = await session("nusrat");
    const shirin = await session("shirin");

    for (let round = 0; round < 10; round++) {
      await resetDb();
      const ride = await bulletRide(2);

      // Requests go out in the order they are created, so alternate who goes first.
      const sendNusrat = () => requestRide(nusrat, "Banani", "Mohakhali");
      const sendShirin = () => requestRide(shirin, "Banani", "Gulshan 1");
      let nusratP: ReturnType<typeof sendNusrat>;
      let shirinP: ReturnType<typeof sendShirin>;
      if (round % 2 === 0) {
        nusratP = sendNusrat();
        shirinP = sendShirin();
      } else {
        shirinP = sendShirin();
        nusratP = sendNusrat();
      }
      const responses = await Promise.all([nusratP, shirinP]);

      const label = `round ${round}: ${responses.map((r) => r.status).join(", ")}`;
      expect(responses.map((r) => r.status), label).toEqual([201, 201]);
      const statuses = responses.map((r) => r.body.status as string).sort();
      expect(statuses, label).toEqual(["MATCHED", "REQUESTED"]);

      expect((await rideOf(ride.id)).seatsOccupied, label).toBe(3);
      expect(await allRides(), label).toHaveLength(1);
      const matched = responses.find((r) => r.body.status === "MATCHED")!;
      const waiting = responses.find((r) => r.body.status === "REQUESTED")!;
      expect(await requestOf(matched.body.id), label).toMatchObject({ status: "MATCHED", rideId: ride.id });
      expect(await requestOf(waiting.body.id), label).toMatchObject({ status: "REQUESTED", rideId: null });
    }
  }, 60_000);
});
