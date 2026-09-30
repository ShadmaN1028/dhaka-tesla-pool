import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { rides } from "../db/schema";
import { AppError } from "../errors";
import type { RideStatus } from "./stateMachine";

// A ride can take new passengers until it has started.
export const JOINABLE_RIDE_STATUSES: RideStatus[] = ["OPEN", "DRIVER_ARRIVED"];

// The seat claim: ONE conditional UPDATE, never read-then-write. No row means the seats are gone.
export async function claimSeats(tx: Tx, rideId: string, seats: number) {
  const [ride] = await tx
    .update(rides)
    .set({ seatsOccupied: sql`${rides.seatsOccupied} + ${seats}`, updatedAt: sql`now()` })
    .where(
      and(
        eq(rides.id, rideId),
        inArray(rides.status, JOINABLE_RIDE_STATUSES),
        sql`${rides.seatsOccupied} + ${seats} <= ${rides.capacity}`,
      ),
    )
    .returning();
  if (!ride) throw new AppError(409, "NOT_ENOUGH_SEATS", "The ride has no room for those seats");
  return ride;
}
