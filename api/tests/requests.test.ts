import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db } from "../src/db/client";
import { rideRequests, rides, statusEvents, users, vehicles } from "../src/db/schema";
import { areaId, loginAs } from "./helpers";

async function requestRide(cookie: string, pickup: string, destination: string, seats = 1) {
  return request(app)
    .post("/requests")
    .set("Cookie", cookie)
    .send({
      pickup_area_id: await areaId(pickup),
      destination_area_id: await areaId(destination),
      seats,
    });
}

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
    const [bullet] = await db.select().from(vehicles).where(eq(vehicles.name, "Bullet"));
    const [ride] = await db
      .insert(rides)
      .values({
        vehicleId: bullet.id,
        pickupAreaId: await areaId("Banani"),
        capacity: bullet.capacity,
        seatsOccupied: 1,
      })
      .returning();
    await db
      .update(rideRequests)
      .set({ status: "MATCHED", rideId: ride.id })
      .where(eq(rideRequests.id, created.body.id));

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
