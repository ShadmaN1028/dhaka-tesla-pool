import { and, eq, inArray, gt, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { rides } from "../db/schema";
import { AppError } from "../errors";
import type { RideStatus } from "./stateMachine";

// A ride can take new passengers until it has started.
export const JOINABLE_RIDE_STATUSES: RideStatus[] = ["OPEN", "DRIVER_ARRIVED"];

// A new request only joins rides created this recently.
export const JOIN_WINDOW_MINUTES = 10;

// The seat claim: ONE conditional UPDATE, never read-then-write. No row means the seats are gone.
export async function tryClaimSeats(tx: Tx, rideId: string, seats: number) {
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
  return ride;
}

export async function claimSeats(tx: Tx, rideId: string, seats: number) {
  const ride = await tryClaimSeats(tx, rideId, seats);
  if (!ride) throw new AppError(409, "NOT_ENOUGH_SEATS", "The ride has no room for those seats");
  return ride;
}

// Claims seats on the oldest compatible ride and returns its id, or null when none has room.
// The claim locks the ride, so callers insert the request afterwards: ride first, then request.
export async function joinCompatibleRide(tx: Tx, pickupAreaId: number, seats: number) {
  const candidates = await tx
    .select({ id: rides.id })
    .from(rides)
    .where(
      and(
        inArray(rides.status, JOINABLE_RIDE_STATUSES),
        eq(rides.pickupAreaId, pickupAreaId),
        gt(rides.createdAt, sql`now() - make_interval(mins => ${JOIN_WINDOW_MINUTES})`),
        sql`${rides.capacity} - ${rides.seatsOccupied} >= ${seats}`,
      ),
    )
    .orderBy(rides.createdAt);

  // The read above is only a shortlist; losing a race for the seats just moves on to the next ride.
  for (const candidate of candidates) {
    if (await tryClaimSeats(tx, candidate.id, seats)) return candidate.id;
  }
  return null;
}
