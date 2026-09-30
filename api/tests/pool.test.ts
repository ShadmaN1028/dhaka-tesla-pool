import { describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { claimSeats } from "../src/domain/pool";
import { bulletRide, rideOf } from "./helpers";

const claim = (rideId: string, seats: number) =>
  db.transaction((tx) => claimSeats(tx, rideId, seats));

describe("claimSeats", () => {
  it.each(["OPEN", "DRIVER_ARRIVED"] as const)(
    "claims seats on a %s ride up to its capacity and returns the updated ride",
    async (status) => {
      const ride = await bulletRide(0, status);

      expect((await claim(ride.id, 1)).seatsOccupied).toBe(1);
      expect((await claim(ride.id, 2)).seatsOccupied).toBe(3);
      expect((await rideOf(ride.id)).seatsOccupied).toBe(3);
    },
  );

  it("refuses more seats than are free with 409 NOT_ENOUGH_SEATS and changes nothing", async () => {
    const ride = await bulletRide(2);

    await expect(claim(ride.id, 2)).rejects.toMatchObject({ status: 409, code: "NOT_ENOUGH_SEATS" });

    expect((await rideOf(ride.id)).seatsOccupied).toBe(2);
    expect((await claim(ride.id, 1)).seatsOccupied).toBe(3);
  });

  it.each(["STARTED", "COMPLETED", "CANCELLED"] as const)(
    "refuses a %s ride even when it has room",
    async (status) => {
      const ride = await bulletRide(0, status);

      await expect(claim(ride.id, 1)).rejects.toMatchObject({ status: 409, code: "NOT_ENOUGH_SEATS" });

      expect((await rideOf(ride.id)).seatsOccupied).toBe(0);
    },
  );

  it("two concurrent claims for the last seat: exactly one succeeds, the other is 409", async () => {
    const ride = await bulletRide(2);

    const results = await Promise.allSettled([claim(ride.id, 1), claim(ride.id, 1)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409, code: "NOT_ENOUGH_SEATS" });
    expect((await rideOf(ride.id)).seatsOccupied).toBe(3);
  });
});
