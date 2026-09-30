import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db } from "../src/db/client";
import { statusEvents, users } from "../src/db/schema";
import {
  bulletRide,
  loginAs,
  requestOf,
  requestRide,
  resetDb,
  rideOf,
  setStatus,
  type SeededUser,
} from "./helpers";

type RideStatus = Awaited<ReturnType<typeof bulletRide>>["status"];

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

const eventsOf = (entityId: string) =>
  db.select().from(statusEvents).where(eq(statusEvents.entityId, entityId)).orderBy(statusEvents.id);

async function jashimsId() {
  const [row] = await db.select().from(users).where(eq(users.email, "jashim@teslapool.dev"));
  return row.id;
}

// Nusrat (Banani → Mohakhali, solo 8500) and Rafiq (Banani → Gulshan 1, solo 7000) matched in one Bullet ride.
async function pooledRide(status: RideStatus = "OPEN") {
  const nusrat = await requestRide(await session("nusrat"), "Banani", "Mohakhali");
  const rafiq = await requestRide(await session("rafiq"), "Banani", "Gulshan 1");
  const ride = await bulletRide(2, status);
  await setStatus(nusrat.body.id, "MATCHED", ride.id);
  await setStatus(rafiq.body.id, "MATCHED", ride.id);
  return { ride, nusratsId: nusrat.body.id as string, rafiqsId: rafiq.body.id as string };
}

describe("ride lifecycle", () => {
  it("pooled ride, arrive → start → complete: Nusrat pays 6800, Rafiq 5600, both COMPLETED", async () => {
    const { ride, nusratsId, rafiqsId } = await pooledRide();
    const jashim = await session("jashim");

    const arrived = await post(jashim, "/driver/ride/arrive");
    expect(arrived.status).toBe(200);
    expect(arrived.body).toMatchObject({ id: ride.id, status: "DRIVER_ARRIVED", seats_occupied: 2 });

    const started = await post(jashim, "/driver/ride/start");
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("STARTED");
    expect(started.body.passengers.map((p: { status: string }) => p.status)).toEqual([
      "IN_PROGRESS",
      "IN_PROGRESS",
    ]);
    expect(await requestOf(nusratsId)).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 6800 });
    expect(await requestOf(rafiqsId)).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 5600 });

    const completed = await post(jashim, "/driver/ride/complete");
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");
    expect(await requestOf(nusratsId)).toMatchObject({ status: "COMPLETED", finalFarePaisa: 6800 });
    expect(await requestOf(rafiqsId)).toMatchObject({ status: "COMPLETED", finalFarePaisa: 5600 });
    expect(await rideOf(ride.id)).toMatchObject({ status: "COMPLETED", seatsOccupied: 2 });

    // The driver never sees fares.
    expect(JSON.stringify([arrived.body, started.body, completed.body])).not.toMatch(/fare/i);

    const driverId = await jashimsId();
    const rideEvents = await eventsOf(ride.id);
    expect(rideEvents.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      ["OPEN", "DRIVER_ARRIVED"],
      ["DRIVER_ARRIVED", "STARTED"],
      ["STARTED", "COMPLETED"],
    ]);
    expect(rideEvents.every((e) => e.entityType === "RIDE" && e.actorUserId === driverId)).toBe(true);
    for (const id of [nusratsId, rafiqsId]) {
      const requestEvents = (await eventsOf(id)).slice(1); // the first is the request being created
      expect(requestEvents.map((e) => [e.fromStatus, e.toStatus])).toEqual([
        ["MATCHED", "IN_PROGRESS"],
        ["IN_PROGRESS", "COMPLETED"],
      ]);
      expect(requestEvents.every((e) => e.actorUserId === driverId)).toBe(true);
    }
  });

  it("Nusrat sees her own final fare and never Rafiq's", async () => {
    const { nusratsId, rafiqsId } = await pooledRide();
    const jashim = await session("jashim");
    await post(jashim, "/driver/ride/arrive");
    await post(jashim, "/driver/ride/start");

    const mine = await get(await session("nusrat"), "/requests");
    expect(mine.body.map((r: { id: string }) => r.id)).toEqual([nusratsId]);
    expect(mine.body[0].final_fare_paisa).toBe(6800);
    expect(JSON.stringify(mine.body)).not.toMatch(new RegExp(`${rafiqsId}|Rafiq|5600`));

    const hisRequest = await get(await session("nusrat"), `/requests/${rafiqsId}`);
    expect(hisRequest.status).toBe(404);

    const rafiqsView = await get(await session("rafiq"), `/requests/${rafiqsId}`);
    expect(rafiqsView.body.final_fare_paisa).toBe(5600);
  });

  it("a solo ride pays the full fare: Nusrat alone gets 8500 and no discount", async () => {
    const created = await requestRide(await session("nusrat"), "Banani", "Mohakhali");
    const ride = await bulletRide(1);
    await setStatus(created.body.id, "MATCHED", ride.id);
    const jashim = await session("jashim");

    await post(jashim, "/driver/ride/arrive");
    const started = await post(jashim, "/driver/ride/start");

    expect(started.status).toBe(200);
    expect(await requestOf(created.body.id)).toMatchObject({
      status: "IN_PROGRESS",
      finalFarePaisa: 8500,
    });
  });

  it("a passenger who cancelled before the start does not count toward the discount", async () => {
    const { nusratsId, rafiqsId } = await pooledRide();
    expect((await post(await session("nusrat"), `/requests/${nusratsId}/cancel`)).status).toBe(200);
    const jashim = await session("jashim");

    await post(jashim, "/driver/ride/arrive");
    await post(jashim, "/driver/ride/start");

    expect(await requestOf(nusratsId)).toMatchObject({ status: "CANCELLED", finalFarePaisa: null });
    expect(await requestOf(rafiqsId)).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 7000 });
  });

  it("starting a ride with no MATCHED requests is 409 RIDE_EMPTY and leaves it DRIVER_ARRIVED", async () => {
    const created = await requestRide(await session("nusrat"), "Banani", "Mohakhali");
    const ride = await bulletRide(1, "DRIVER_ARRIVED");
    await setStatus(created.body.id, "MATCHED", ride.id);
    expect((await post(await session("nusrat"), `/requests/${created.body.id}/cancel`)).status).toBe(200);
    const jashim = await session("jashim");

    const res = await post(jashim, "/driver/ride/start");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RIDE_EMPTY");
    expect((await rideOf(ride.id)).status).toBe("DRIVER_ARRIVED");
    expect(await eventsOf(ride.id)).toHaveLength(0);
    // The driver is not stuck: the empty ride can still be cancelled.
    expect((await post(jashim, "/driver/ride/cancel")).status).toBe(200);
  });

  it.each([
    ["start from OPEN", "OPEN", "/driver/ride/start", "Cannot move ride from OPEN to STARTED"],
    [
      "complete from DRIVER_ARRIVED",
      "DRIVER_ARRIVED",
      "/driver/ride/complete",
      "Cannot move ride from DRIVER_ARRIVED to COMPLETED",
    ],
    [
      "cancel after STARTED",
      "STARTED",
      "/driver/ride/cancel",
      "Cannot move ride from STARTED to CANCELLED",
    ],
    [
      "arrive twice",
      "DRIVER_ARRIVED",
      "/driver/ride/arrive",
      "Cannot move ride from DRIVER_ARRIVED to DRIVER_ARRIVED",
    ],
  ] as const)("%s is 409 INVALID_TRANSITION and changes nothing", async (_name, status, path, message) => {
    const { ride, nusratsId, rafiqsId } = await pooledRide(status);

    const res = await post(await session("jashim"), path);

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: "INVALID_TRANSITION", message });
    expect((await rideOf(ride.id)).status).toBe(status);
    expect((await requestOf(nusratsId)).status).toBe("MATCHED");
    expect((await requestOf(rafiqsId)).status).toBe("MATCHED");
    expect(await eventsOf(ride.id)).toHaveLength(0);
  });

  it.each(["arrive", "start", "complete", "cancel"])(
    "%s is 404 when the driver has no active ride (a finished one does not count)",
    async (action) => {
      await bulletRide(2, "COMPLETED");

      const res = await post(await session("jashim"), `/driver/ride/${action}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    },
  );

  it.each(["OPEN", "DRIVER_ARRIVED"] as const)(
    "driver cancel from %s: the ride and both requests are CANCELLED, seats stay as history, Nusrat can request again",
    async (status) => {
      const { ride, nusratsId, rafiqsId } = await pooledRide(status);

      const res = await post(await session("jashim"), "/driver/ride/cancel");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ride.id, status: "CANCELLED", passengers: [] });
      expect(await rideOf(ride.id)).toMatchObject({ status: "CANCELLED", seatsOccupied: 2 });
      expect(await requestOf(nusratsId)).toMatchObject({ status: "CANCELLED", rideId: ride.id });
      expect(await requestOf(rafiqsId)).toMatchObject({ status: "CANCELLED", rideId: ride.id });

      const driverId = await jashimsId();
      const rideEvents = await eventsOf(ride.id);
      expect(rideEvents.map((e) => [e.fromStatus, e.toStatus])).toEqual([[status, "CANCELLED"]]);
      expect(rideEvents[0].actorUserId).toBe(driverId);
      const lastEvent = (await eventsOf(nusratsId)).at(-1);
      expect(lastEvent).toMatchObject({
        fromStatus: "MATCHED",
        toStatus: "CANCELLED",
        actorUserId: driverId,
      });

      const again = await requestRide(await session("nusrat"), "Banani", "Mohakhali");
      expect(again.status).toBe(201);
      expect(again.body.status).toBe("REQUESTED");
    },
  );

  it("start racing with Nusrat's cancel, 10 times: never a 500, and the outcome is always consistent", async () => {
    const jashim = await session("jashim");
    const nusrat = await session("nusrat");

    for (let round = 0; round < 10; round++) {
      await resetDb();
      const { ride, nusratsId, rafiqsId } = await pooledRide("DRIVER_ARRIVED");

      // Requests go out in the order they are created, so alternate who goes first: each outcome
      // (the ride starts first / Nusrat cancels first) is then exercised.
      const sendStart = () => post(jashim, "/driver/ride/start").then((r) => r);
      const sendCancel = () => post(nusrat, `/requests/${nusratsId}/cancel`).then((r) => r);
      let startP: ReturnType<typeof sendStart>;
      let cancelP: ReturnType<typeof sendCancel>;
      if (round % 2 === 0) {
        startP = sendStart();
        cancelP = sendCancel();
      } else {
        cancelP = sendCancel();
        startP = sendStart();
      }
      const [startRes, cancelRes] = await Promise.all([startP, cancelP]);

      const label = `round ${round}: start ${startRes.status}, cancel ${cancelRes.status}`;
      expect(startRes.status, label).toBe(200);
      expect([200, 409], label).toContain(cancelRes.status);

      const nusratRow = await requestOf(nusratsId);
      const rafiqRow = await requestOf(rafiqsId);
      const rideRow = await rideOf(ride.id);
      expect(rideRow.status, label).toBe("STARTED");
      if (cancelRes.status === 200) {
        // Nusrat got out first: her seat is released and Rafiq rides alone at the full fare.
        expect(nusratRow, label).toMatchObject({ status: "CANCELLED", finalFarePaisa: null });
        expect(rideRow.seatsOccupied, label).toBe(1);
        expect(rafiqRow, label).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 7000 });
      } else {
        // The ride started first: both are in progress at the pooled fares, nothing was released.
        expect(cancelRes.body.error.code, label).toBe("INVALID_TRANSITION");
        expect(nusratRow, label).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 6800 });
        expect(rafiqRow, label).toMatchObject({ status: "IN_PROGRESS", finalFarePaisa: 5600 });
        expect(rideRow.seatsOccupied, label).toBe(2);
      }
    }
  }, 60_000);
});

describe("lifecycle routes are driver-only", () => {
  it.each(["arrive", "start", "complete", "cancel"])("Nusrat calling %s gets 403", async (action) => {
    const res = await post(await session("nusrat"), `/driver/ride/${action}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("requires a session", async () => {
    expect((await request(app).post("/driver/ride/start")).status).toBe(401);
  });
});
