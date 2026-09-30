import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db } from "../src/db/client";
import { rideRequests, rides, statusEvents, users } from "../src/db/schema";
import {
  areaId,
  bulletRide,
  loginAs,
  requestOf,
  requestRide,
  rideOf,
  setStatus,
  waitForLockWait,
} from "./helpers";

const cancel = (cookie: string, requestId: string) =>
  request(app).post(`/requests/${requestId}/cancel`).set("Cookie", cookie);

describe("GET /areas", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/areas")).status).toBe(401);
  });

  it("lists all areas as { id, name }, sorted by name", async () => {
    const res = await request(app).get("/areas").set("Cookie", await loginAs("nusrat"));

    expect(res.status).toBe(200);
    expect(res.body.map((a: { name: string }) => a.name)).toEqual([
      "Banani",
      "Bashundhara",
      "Dhanmondi",
      "Farmgate",
      "Gulshan 1",
      "Gulshan 2",
      "Mirpur",
      "Mohakhali",
      "Uttara",
    ]);
    for (const area of res.body) {
      expect(Object.keys(area).sort()).toEqual(["id", "name"]);
      expect(typeof area.id).toBe("number");
    }
  });
});

describe("POST /requests", () => {
  it("Nusrat, Banani → Mohakhali, 1 seat: 201 REQUESTED at 8500 paisa with a status event", async () => {
    const res = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "REQUESTED",
      seats: 1,
      pickup_area: { name: "Banani" },
      destination_area: { name: "Mohakhali" },
      estimated_fare_paisa: 8500,
      final_fare_paisa: null,
      ride_id: null,
      driver: null,
    });
    expect(Object.keys(res.body).sort()).toEqual([
      "created_at",
      "destination_area",
      "driver",
      "estimated_fare_paisa",
      "final_fare_paisa",
      "id",
      "pickup_area",
      "ride_id",
      "seats",
      "status",
    ]);

    const [nusrat] = await db.select().from(users).where(eq(users.email, "nusrat@teslapool.dev"));
    const events = await db.select().from(statusEvents).where(eq(statusEvents.entityId, res.body.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "RIDE_REQUEST",
      fromStatus: null,
      toStatus: "REQUESTED",
      actorUserId: nusrat.id,
    });
  });

  it("prices from the distance table: Rafiq, Banani → Gulshan 1 is 7000 paisa", async () => {
    const res = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");

    expect(res.status).toBe(201);
    expect(res.body.estimated_fare_paisa).toBe(7000);
  });

  it("prices every seat: 2 seats, Banani → Mohakhali is 17000 paisa", async () => {
    const res = await requestRide(await loginAs("shirin"), "Banani", "Mohakhali", 2);

    expect(res.status).toBe(201);
    expect(res.body.estimated_fare_paisa).toBe(17000);
  });

  it("rejects a second request while one is active with 409 ACTIVE_REQUEST_EXISTS", async () => {
    const nusrat = await loginAs("nusrat");
    expect((await requestRide(nusrat, "Banani", "Mohakhali")).status).toBe(201);

    const again = await requestRide(nusrat, "Banani", "Gulshan 1");

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ACTIVE_REQUEST_EXISTS");
    // The failed attempt must roll back completely: no extra request and no orphan event.
    expect(await db.select().from(rideRequests)).toHaveLength(1);
    expect(await db.select().from(statusEvents)).toHaveLength(1);
  });

  it("allows a new request once the previous one is no longer active, and lists newest first", async () => {
    const nusrat = await loginAs("nusrat");
    const first = await requestRide(nusrat, "Banani", "Mohakhali");
    await db.update(rideRequests).set({ status: "CANCELLED" }).where(eq(rideRequests.id, first.body.id));

    const second = await requestRide(nusrat, "Banani", "Gulshan 1");
    expect(second.status).toBe(201);

    const list = await request(app).get("/requests").set("Cookie", nusrat);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([second.body.id, first.body.id]);
  });

  it("rejects pickup = destination with 400 and stores nothing", async () => {
    const res = await requestRide(await loginAs("nusrat"), "Banani", "Banani");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(rideRequests)).toHaveLength(0);
  });

  it("rejects seats outside 1–3 with 400", async () => {
    const nusrat = await loginAs("nusrat");
    for (const seats of [0, 4, 1.5]) {
      const res = await requestRide(nusrat, "Banani", "Mohakhali", seats);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects an unknown area with 400", async () => {
    const res = await request(app)
      .post("/requests")
      .set("Cookie", await loginAs("nusrat"))
      .send({ pickup_area_id: await areaId("Banani"), destination_area_id: 999999, seats: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toContain("destination_area_id");
  });

  it("is passenger-only: Jashim (driver) gets 403 FORBIDDEN", async () => {
    const res = await requestRide(await loginAs("jashim"), "Banani", "Mohakhali");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /requests and GET /requests/:id", () => {
  it("shows a passenger only their own requests, and answers 404 for someone else's", async () => {
    const nusrat = await loginAs("nusrat");
    const rafiq = await loginAs("rafiq");
    const nusratsRequest = await requestRide(nusrat, "Banani", "Mohakhali");
    const rafiqsRequest = await requestRide(rafiq, "Banani", "Gulshan 1");

    const rafiqsList = await request(app).get("/requests").set("Cookie", rafiq);
    expect(rafiqsList.status).toBe(200);
    expect(rafiqsList.body.map((r: { id: string }) => r.id)).toEqual([rafiqsRequest.body.id]);
    expect(JSON.stringify(rafiqsList.body)).not.toContain(nusratsRequest.body.id);

    const stolen = await request(app).get(`/requests/${nusratsRequest.body.id}`).set("Cookie", rafiq);
    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe("NOT_FOUND");

    const own = await request(app).get(`/requests/${nusratsRequest.body.id}`).set("Cookie", nusrat);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(nusratsRequest.body.id);
  });

  it("answers 404 for an id that does not exist, and 400 for one that is not a UUID", async () => {
    const nusrat = await loginAs("nusrat");

    const missing = await request(app)
      .get("/requests/3f2b8c1e-6d4a-4b7e-9a10-1c2d3e4f5a6b")
      .set("Cookie", nusrat);
    expect(missing.status).toBe(404);

    const malformed = await request(app).get("/requests/not-a-uuid").set("Cookie", nusrat);
    expect(malformed.status).toBe(400);
  });

  it("shows the driver and vehicle name once the request is matched", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    const ride = await bulletRide(1);
    await setStatus(created.body.id, "MATCHED", ride.id);

    const res = await request(app).get(`/requests/${created.body.id}`).set("Cookie", nusrat);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "MATCHED",
      ride_id: ride.id,
      driver: { name: "Jashim", vehicle: "Bullet" },
    });
  });

  it("is passenger-only: Jashim (driver) gets 403 on both", async () => {
    const jashim = await loginAs("jashim");

    expect((await request(app).get("/requests").set("Cookie", jashim)).status).toBe(403);
    expect(
      (await request(app).get("/requests/3f2b8c1e-6d4a-4b7e-9a10-1c2d3e4f5a6b").set("Cookie", jashim))
        .status,
    ).toBe(403);
  });
});

describe("POST /requests/:id/cancel", () => {
  const eventsOf = (requestId: string) =>
    db.select().from(statusEvents).where(eq(statusEvents.entityId, requestId)).orderBy(statusEvents.id);

  it("Nusrat cancels her REQUESTED request: 200 CANCELLED, same shape as GET, with a status event", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");

    const res = await cancel(nusrat, created.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, status: "CANCELLED", ride_id: null });
    const fetched = await request(app).get(`/requests/${created.body.id}`).set("Cookie", nusrat);
    expect(res.body).toEqual(fetched.body);

    const [nusratRow] = await db.select().from(users).where(eq(users.email, "nusrat@teslapool.dev"));
    const events = await eventsOf(created.body.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      entityType: "RIDE_REQUEST",
      fromStatus: "REQUESTED",
      toStatus: "CANCELLED",
      actorUserId: nusratRow.id,
    });
  });

  it("cancelling again is 409 INVALID_TRANSITION and records nothing new", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    expect((await cancel(nusrat, created.body.id)).status).toBe(200);

    const again = await cancel(nusrat, created.body.id);

    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({
      code: "INVALID_TRANSITION",
      message: "Cannot move ride request from CANCELLED to CANCELLED",
    });
    expect(await eventsOf(created.body.id)).toHaveLength(2);
  });

  it("answers 404 when Rafiq cancels Nusrat's request, and leaves it unchanged", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");

    const res = await cancel(await loginAs("rafiq"), created.body.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect((await requestOf(created.body.id)).status).toBe("REQUESTED");
    expect(await eventsOf(created.body.id)).toHaveLength(1);
  });

  it("answers 404 for a request that does not exist", async () => {
    const res = await cancel(await loginAs("nusrat"), "3f2b8c1e-6d4a-4b7e-9a10-1c2d3e4f5a6b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("MATCHED: releases the seat on Bullet's ride and keeps ride_id on the cancelled request", async () => {
    const nusrat = await loginAs("nusrat");
    const nusratsRequest = await requestRide(nusrat, "Banani", "Mohakhali");
    const rafiqsRequest = await requestRide(await loginAs("rafiq"), "Banani", "Gulshan 1");
    const ride = await bulletRide(2);
    await setStatus(nusratsRequest.body.id, "MATCHED", ride.id);
    await setStatus(rafiqsRequest.body.id, "MATCHED", ride.id);

    const res = await cancel(nusrat, nusratsRequest.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", ride_id: ride.id });
    expect(await rideOf(ride.id)).toMatchObject({ seatsOccupied: 1, status: "OPEN" });
    expect(await requestOf(nusratsRequest.body.id)).toMatchObject({ status: "CANCELLED", rideId: ride.id });
    expect(await requestOf(rafiqsRequest.body.id)).toMatchObject({ status: "MATCHED", rideId: ride.id });
    expect((await eventsOf(nusratsRequest.body.id)).at(-1)).toMatchObject({
      fromStatus: "MATCHED",
      toStatus: "CANCELLED",
    });
  });

  it("MATCHED: releases exactly the request's own seats, and an emptied ride stays OPEN", async () => {
    const nusrat = await loginAs("nusrat");
    const shirin = await loginAs("shirin");
    const nusratsRequest = await requestRide(nusrat, "Banani", "Mohakhali", 1);
    const shirinsRequest = await requestRide(shirin, "Banani", "Gulshan 1", 2);
    const ride = await bulletRide(3);
    await setStatus(nusratsRequest.body.id, "MATCHED", ride.id);
    await setStatus(shirinsRequest.body.id, "MATCHED", ride.id);

    expect((await cancel(nusrat, nusratsRequest.body.id)).status).toBe(200);
    expect((await rideOf(ride.id)).seatsOccupied).toBe(2);

    expect((await cancel(shirin, shirinsRequest.body.id)).status).toBe(200);
    expect(await rideOf(ride.id)).toMatchObject({ seatsOccupied: 0, status: "OPEN" });
  });

  it.each(["IN_PROGRESS", "COMPLETED"] as const)(
    "%s cannot be cancelled: 409 INVALID_TRANSITION, request and ride untouched",
    async (status) => {
      const nusrat = await loginAs("nusrat");
      const created = await requestRide(nusrat, "Banani", "Mohakhali");
      const ride = await bulletRide(1);
      await setStatus(created.body.id, status, ride.id);

      const res = await cancel(nusrat, created.body.id);

      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: "INVALID_TRANSITION",
        message: `Cannot move ride request from ${status} to CANCELLED`,
      });
      expect((await requestOf(created.body.id)).status).toBe(status);
      expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
      expect(await eventsOf(created.body.id)).toHaveLength(1);
    },
  );

  it("frees the one-active-request rule: Nusrat can request again after cancelling", async () => {
    const nusrat = await loginAs("nusrat");
    const first = await requestRide(nusrat, "Banani", "Mohakhali");
    expect((await requestRide(nusrat, "Banani", "Gulshan 1")).status).toBe(409);

    expect((await cancel(nusrat, first.body.id)).status).toBe(200);

    const second = await requestRide(nusrat, "Banani", "Gulshan 1");
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("REQUESTED");
  });

  it("two simultaneous cancels of one MATCHED request: one wins, the seat is released once", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    const ride = await bulletRide(2);
    await setStatus(created.body.id, "MATCHED", ride.id);

    const results = await Promise.all([
      cancel(nusrat, created.body.id),
      cancel(nusrat, created.body.id),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
    const cancelledEvents = (await eventsOf(created.body.id)).filter((e) => e.toStatus === "CANCELLED");
    expect(cancelledEvents).toHaveLength(1);
  });

  it("locks the ride before the request: against a start-style transaction (ride, then requests) it cannot deadlock", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    const ride = await bulletRide(1);
    await setStatus(created.body.id, "MATCHED", ride.id);

    let rideLocked!: () => void;
    const rideLockedP = new Promise<void>((resolve) => (rideLocked = resolve));
    let proceed!: () => void;
    const proceedP = new Promise<void>((resolve) => (proceed = resolve));

    // Stands in for ride start, which is not built yet: lock the ride, then touch its requests.
    const start = db.transaction(async (tx) => {
      await tx.select({ id: rides.id }).from(rides).where(eq(rides.id, ride.id)).for("update");
      rideLocked();
      await proceedP;
      await tx
        .update(rideRequests)
        .set({ status: "IN_PROGRESS" })
        .where(eq(rideRequests.rideId, ride.id));
    });
    await rideLockedP;
    const cancelling = cancel(nusrat, created.body.id).then((r) => r);
    await waitForLockWait();
    proceed();

    await start; // would be aborted as a deadlock victim if cancel held the request while waiting for the ride
    const res = await cancelling;

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Cannot move ride request from IN_PROGRESS to CANCELLED");
    expect((await requestOf(created.body.id)).status).toBe("IN_PROGRESS");
    expect((await rideOf(ride.id)).seatsOccupied).toBe(1);
  }, 30_000);

  it("a request matched while the cancel is waiting is still cancelled, releasing its seat exactly once", async () => {
    const nusrat = await loginAs("nusrat");
    const created = await requestRide(nusrat, "Banani", "Mohakhali");
    const ride = await bulletRide(1);

    let matchedInTx!: () => void;
    const matchedP = new Promise<void>((resolve) => (matchedInTx = resolve));
    let proceed!: () => void;
    const proceedP = new Promise<void>((resolve) => (proceed = resolve));

    // A driver match that is still uncommitted: the cancel reads the request as unmatched (no
    // ride_id), then blocks on the row, then finds it MATCHED once the match commits.
    const matching = db.transaction(async (tx) => {
      await tx
        .update(rideRequests)
        .set({ status: "MATCHED", rideId: ride.id })
        .where(eq(rideRequests.id, created.body.id));
      matchedInTx();
      await proceedP;
    });
    await matchedP;
    const cancelling = cancel(nusrat, created.body.id).then((r) => r);
    await waitForLockWait();
    proceed();

    await matching;
    const res = await cancelling;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", ride_id: ride.id });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(0);
    const events = await eventsOf(created.body.id);
    expect(events.filter((e) => e.toStatus === "CANCELLED")).toMatchObject([
      { fromStatus: "MATCHED", toStatus: "CANCELLED" },
    ]);
  }, 30_000);

  it("is passenger-only: Jashim gets 403, and no session gets 401", async () => {
    const created = await requestRide(await loginAs("nusrat"), "Banani", "Mohakhali");

    expect((await cancel(await loginAs("jashim"), created.body.id)).status).toBe(403);
    expect((await request(app).post(`/requests/${created.body.id}/cancel`)).status).toBe(401);
    expect((await requestOf(created.body.id)).status).toBe("REQUESTED");
  });
});
