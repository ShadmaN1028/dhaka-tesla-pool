import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db } from "../src/db/client";
import { rides, statusEvents, users } from "../src/db/schema";
import {
  areaId,
  bulletRide,
  loginAs,
  requestOf,
  requestRide,
  resetDb,
  rideOf,
  setStatus,
} from "./helpers";

const post = (cookie: string, path: string) => request(app).post(path).set("Cookie", cookie);
const get = (cookie: string, path: string) => request(app).get(path).set("Cookie", cookie);

async function jashimIsOnline() {
  const [row] = await db
    .select({ isOnline: users.isOnline })
    .from(users)
    .where(eq(users.email, "jashim@teslapool.dev"));
  return row.isOnline;
}

describe("POST /driver/online and /driver/offline", () => {
  it("toggle is_online", async () => {
    const jashim = await loginAs("jashim");

    const online = await post(jashim, "/driver/online");
    expect(online.status).toBe(200);
    expect(online.body).toEqual({ is_online: true });
    expect(await jashimIsOnline()).toBe(true);

    const offline = await post(jashim, "/driver/offline");
    expect(offline.status).toBe(200);
    expect(offline.body).toEqual({ is_online: false });
    expect(await jashimIsOnline()).toBe(false);
  });

  it.each(["OPEN", "DRIVER_ARRIVED", "STARTED"] as const)(
    "going offline with a %s ride is 409 HAS_ACTIVE_RIDE and keeps the driver online",
    async (status) => {
      const jashim = await loginAs("jashim");
      await post(jashim, "/driver/online");
      await bulletRide(0, status);

      const res = await post(jashim, "/driver/offline");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("HAS_ACTIVE_RIDE");
      expect(await jashimIsOnline()).toBe(true);
    },
  );

  it("a finished ride does not stop the driver going offline", async () => {
    const jashim = await loginAs("jashim");
    await post(jashim, "/driver/online");
    await bulletRide(2, "COMPLETED");
    await bulletRide(0, "CANCELLED");

    expect((await post(jashim, "/driver/offline")).status).toBe(200);
    expect(await jashimIsOnline()).toBe(false);
  });
});

describe("GET /driver/requests", () => {
  it("is 409 DRIVER_OFFLINE while the driver is offline", async () => {
    const res = await get(await loginAs("jashim"), "/driver/requests");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_OFFLINE");
  });

  it("shows Nusrat's REQUESTED request to an online driver, without any fare field", async () => {
    await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali", 1);
    const jashim = await loginAs("jashim");
    await post(jashim, "/driver/online");

    const res = await get(jashim, "/driver/requests");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      passenger_name: "Nusrat",
      seats: 1,
      pickup_area: { name: "Banani" },
      destination_area: { name: "Mohakhali" },
    });
    expect(Object.keys(res.body[0]).sort()).toEqual([
      "created_at",
      "destination_area",
      "id",
      "passenger_name",
      "pickup_area",
      "seats",
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/fare/i);
  });

  it("lists only REQUESTED requests, oldest first", async () => {
    const nusrat = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");
    const rafiq = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");
    const shirin = await requestRide(await loginAs("shirin"), "Banani", "Mohakhali");
    const ride = await bulletRide(1);
    await setStatus(rafiq.body.id, "MATCHED", ride.id);
    const jashim = await loginAs("jashim");
    await post(jashim, "/driver/online");

    const res = await get(jashim, "/driver/requests");

    expect(res.body.map((r: { id: string }) => r.id)).toEqual([nusrat.body.id, shirin.body.id]);
  });
});

describe("GET /driver/ride", () => {
  it("is null when the driver has no ride", async () => {
    const res = await get(await loginAs("jashim"), "/driver/ride");

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("is null when the only ride is finished", async () => {
    await bulletRide(2, "COMPLETED");

    const res = await get(await loginAs("jashim"), "/driver/ride");

    expect(res.body).toBeNull();
  });

  it("shows Bullet's ride with its passengers, leaving out CANCELLED ones and any fare", async () => {
    const nusrat = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");
    const rafiq = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");
    const shirin = await requestRide(await loginAs("shirin"), "Banani", "Mohakhali");
    const ride = await bulletRide(2, "DRIVER_ARRIVED");
    await setStatus(nusrat.body.id, "MATCHED", ride.id);
    await setStatus(rafiq.body.id, "MATCHED", ride.id);
    await setStatus(shirin.body.id, "CANCELLED", ride.id);

    const res = await get(await loginAs("jashim"), "/driver/ride");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ride.id,
      status: "DRIVER_ARRIVED",
      capacity: 3,
      seats_occupied: 2,
      pickup_area: { name: "Banani" },
      vehicle_name: "Bullet",
    });
    expect(res.body.passengers.map((p: { passenger_name: string }) => p.passenger_name)).toEqual([
      "Nusrat",
      "Rafiq",
    ]);
    expect(res.body.passengers[0]).toMatchObject({
      seats: 1,
      destination_area: { name: "Mohakhali" },
      status: "MATCHED",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/fare|Shirin/i);
  });
});

describe("GET /driver/rides", () => {
  it("lists finished rides newest first with passenger count and seats used", async () => {
    const cancelledRide = await bulletRide(0, "CANCELLED");
    const completedRide = await bulletRide(2, "COMPLETED");
    await bulletRide(1, "OPEN");
    const nusrat = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");
    const rafiq = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");
    const shirin = await requestRide(await loginAs("shirin"), "Banani", "Mohakhali");
    await setStatus(nusrat.body.id, "COMPLETED", completedRide.id);
    await setStatus(rafiq.body.id, "COMPLETED", completedRide.id);
    await setStatus(shirin.body.id, "CANCELLED", completedRide.id);

    const res = await get(await loginAs("jashim"), "/driver/rides");

    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([completedRide.id, cancelledRide.id]);
    expect(res.body[0]).toMatchObject({
      status: "COMPLETED",
      pickup_area: { name: "Banani" },
      vehicle_name: "Bullet",
      passenger_count: 2,
      seats_used: 2,
    });
    expect(res.body[1]).toMatchObject({ status: "CANCELLED", passenger_count: 0, seats_used: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/fare/i);
  });
});

describe("POST /driver/requests/:id/accept", () => {
  const accept = (cookie: string, requestId: string) =>
    post(cookie, `/driver/requests/${requestId}/accept`);
  const allRides = () => db.select().from(rides);
  const eventsOf = (entityId: string) =>
    db.select().from(statusEvents).where(eq(statusEvents.entityId, entityId)).orderBy(statusEvents.id);

  async function onlineJashim() {
    const jashim = await loginAs("jashim");
    await post(jashim, "/driver/online");
    return jashim;
  }

  it("Jashim accepts Nusrat's request: a new OPEN ride with her seat, both status events, and she sees Jashim / Bullet", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    const jashim = await onlineJashim();

    const res = await accept(jashim, created.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "OPEN",
      capacity: 3,
      seats_occupied: 1,
      pickup_area: { name: "Banani" },
      vehicle_name: "Bullet",
      passengers: [
        {
          passenger_name: "Nusrat",
          seats: 1,
          destination_area: { name: "Mohakhali" },
          status: "MATCHED",
        },
      ],
    });
    expect((await get(jashim, "/driver/ride")).body).toEqual(res.body);

    const [ride] = await allRides();
    expect(ride).toMatchObject({
      id: res.body.id,
      status: "OPEN",
      capacity: 3,
      seatsOccupied: 1,
      pickupAreaId: await areaId("Banani"),
    });
    expect(await requestOf(created.body.id)).toMatchObject({ status: "MATCHED", rideId: ride.id });

    const [jashimRow] = await db.select().from(users).where(eq(users.email, "jashim@teslapool.dev"));
    expect(await eventsOf(ride.id)).toMatchObject([
      { entityType: "RIDE", fromStatus: null, toStatus: "OPEN", actorUserId: jashimRow.id },
    ]);
    const requestEvents = await eventsOf(created.body.id);
    expect(requestEvents).toHaveLength(2);
    expect(requestEvents[1]).toMatchObject({
      entityType: "RIDE_REQUEST",
      fromStatus: "REQUESTED",
      toStatus: "MATCHED",
      actorUserId: jashimRow.id,
    });

    const seenByNusrat = await get(nusrat, `/requests/${created.body.id}`);
    expect(seenByNusrat.body).toMatchObject({
      status: "MATCHED",
      ride_id: ride.id,
      driver: { name: "Jashim", vehicle: "Bullet" },
    });
  });

  it("is 409 DRIVER_OFFLINE while the driver is offline, and changes nothing", async () => {
    const created = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");

    const res = await accept(await loginAs("jashim"), created.body.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DRIVER_OFFLINE");
    expect(await allRides()).toHaveLength(0);
    expect((await requestOf(created.body.id)).status).toBe("REQUESTED");
  });

  it("a second accept while the ride is active is 409 VEHICLE_HAS_ACTIVE_RIDE and leaves that request REQUESTED", async () => {
    const first = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");
    const second = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");
    const jashim = await onlineJashim();
    expect((await accept(jashim, first.body.id)).status).toBe(200);

    const res = await accept(jashim, second.body.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VEHICLE_HAS_ACTIVE_RIDE");
    expect((await requestOf(second.body.id)).status).toBe("REQUESTED");
    const [ride, ...others] = await allRides();
    expect(others).toHaveLength(0);
    expect(ride.seatsOccupied).toBe(1);
  });

  it("an already-cancelled request is 409 REQUEST_UNAVAILABLE and leaves no ride behind", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    await post(nusrat, `/requests/${created.body.id}/cancel`);
    const jashim = await onlineJashim();

    const res = await accept(jashim, created.body.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REQUEST_UNAVAILABLE");
    expect(await allRides()).toHaveLength(0);
    expect((await requestOf(created.body.id)).status).toBe("CANCELLED");
    expect(await eventsOf(created.body.id)).toHaveLength(2);
  });

  it("a request someone else already took is 409 REQUEST_UNAVAILABLE and leaves no new ride behind", async () => {
    const created = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");
    const earlierRide = await bulletRide(1, "COMPLETED");
    await setStatus(created.body.id, "MATCHED", earlierRide.id);

    const res = await accept(await onlineJashim(), created.body.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REQUEST_UNAVAILABLE");
    expect(await allRides()).toHaveLength(1);
    expect(await requestOf(created.body.id)).toMatchObject({ status: "MATCHED", rideId: earlierRide.id });
  });

  it("a request for 3 seats fills Bullet exactly", async () => {
    const created = await requestRide(await loginAs("shirin"), "Banani", "Mohakhali", 3);

    const res = await accept(await onlineJashim(), created.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ capacity: 3, seats_occupied: 3 });
    const [ride] = await allRides();
    expect(await rideOf(ride.id)).toMatchObject({ capacity: 3, seatsOccupied: 3 });
  });

  it("answers 404 for a request that does not exist, and creates no ride", async () => {
    const res = await accept(await onlineJashim(), "3f2b8c1e-6d4a-4b7e-9a10-1c2d3e4f5a6b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(await allRides()).toHaveLength(0);
  });

  it("accept racing with offline never leaves the driver offline with an active ride", async () => {
    const jashim = await loginAs("jashim");
    const nusrat = await loginAs("nusrat");

    for (let round = 0; round < 20; round++) {
      await resetDb();
      await post(jashim, "/driver/online");
      const created = await requestRide(nusrat, "Banani", "Mohakhali");

      const [acceptRes, offlineRes] = await Promise.all([
        accept(jashim, created.body.id),
        post(jashim, "/driver/offline"),
      ]);

      const accepted = acceptRes.status === 200;
      const wentOffline = offlineRes.status === 200;
      // Exactly one of them wins; both succeeding would mean offline with an active ride.
      expect(accepted !== wentOffline, `round ${round}: accept ${acceptRes.status}, offline ${offlineRes.status}`).toBe(true);
      if (accepted) {
        expect(offlineRes.body.error.code).toBe("HAS_ACTIVE_RIDE");
        expect(await jashimIsOnline()).toBe(true);
        expect(await allRides()).toHaveLength(1);
      } else {
        expect(acceptRes.body.error.code).toBe("DRIVER_OFFLINE");
        expect(await jashimIsOnline()).toBe(false);
        expect(await allRides()).toHaveLength(0);
      }
    }
  }, 60_000);
});

describe("driver routes are driver-only", () => {
  it.each([
    ["POST", "/driver/online"],
    ["POST", "/driver/offline"],
    ["GET", "/driver/requests"],
    ["GET", "/driver/ride"],
    ["GET", "/driver/rides"],
    ["POST", "/driver/requests/3f2b8c1e-6d4a-4b7e-9a10-1c2d3e4f5a6b/accept"],
  ] as const)("Nusrat calling %s %s gets 403 FORBIDDEN", async (method, path) => {
    const nusrat = await loginAs("nusrat");

    const res =
      method === "POST" ? await post(nusrat, path) : await get(nusrat, path);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("requires a session", async () => {
    expect((await request(app).get("/driver/ride")).status).toBe(401);
  });
});
