import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { areas, rides, vehicles } from "../src/db/schema";
import { httpLogger } from "../src/logger";
import { errorHandler } from "../src/middleware/errorHandler";
import { areaId } from "./helpers";

// A separate mini app that triggers real Postgres unique violations through Drizzle.
const failing = express();
failing.use(httpLogger);
failing.get("/two-active-rides", async () => {
  const [bullet] = await db.select().from(vehicles).where(eq(vehicles.name, "Bullet"));
  const ride = { vehicleId: bullet.id, pickupAreaId: await areaId("Banani"), capacity: bullet.capacity };
  await db.insert(rides).values(ride);
  await db.insert(rides).values(ride);
});
failing.get("/duplicate-area", async () => {
  await db.insert(areas).values({ name: "Banani" });
});
failing.use(errorHandler);

describe("unique violation mapping", () => {
  it("maps a second active ride for one vehicle to 409 VEHICLE_HAS_ACTIVE_RIDE", async () => {
    const res = await request(failing).get("/two-active-rides");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VEHICLE_HAS_ACTIVE_RIDE");
  });

  it("leaves unmapped unique violations as a generic 500", async () => {
    const res = await request(failing).get("/duplicate-area");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
