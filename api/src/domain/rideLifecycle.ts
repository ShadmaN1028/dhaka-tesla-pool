import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db/client";
import { rideRequests, rides, statusEvents, vehicles } from "../db/schema";
import { AppError } from "../errors";
import { finalFarePaisa } from "./fare";
import {
  ACTIVE_RIDE_STATUSES,
  assertRequestTransition,
  assertRideTransition,
  type RideRequestStatus,
  type RideStatus,
} from "./stateMachine";

type EventRow = typeof statusEvents.$inferInsert;

const requestEvent = (
  requestId: string,
  from: RideRequestStatus,
  to: RideRequestStatus,
  driverId: string,
): EventRow => ({
  entityType: "RIDE_REQUEST",
  entityId: requestId,
  fromStatus: from,
  toStatus: to,
  actorUserId: driverId,
});

// Lock order: the ride first, then its requests. Every lifecycle transition starts here.
async function lockActiveRide(tx: Tx, driverId: string) {
  const [ride] = await tx
    .select({ id: rides.id, status: rides.status })
    .from(rides)
    .innerJoin(vehicles, eq(rides.vehicleId, vehicles.id))
    .where(and(eq(vehicles.driverId, driverId), inArray(rides.status, ACTIVE_RIDE_STATUSES)))
    .for("update", { of: rides });
  if (!ride) throw new AppError(404, "NOT_FOUND", "You have no active ride");
  return ride;
}

// The state machine decides, then a conditional UPDATE on the locked status applies it.
async function moveRide(
  tx: Tx,
  ride: { id: string; status: RideStatus },
  to: RideStatus,
  driverId: string,
): Promise<EventRow> {
  assertRideTransition(ride.status, to);
  const [moved] = await tx
    .update(rides)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(rides.id, ride.id), eq(rides.status, ride.status)))
    .returning({ id: rides.id });
  if (!moved) throw new Error(`Ride ${ride.id} left ${ride.status} while this transaction held it`);
  return {
    entityType: "RIDE",
    entityId: ride.id,
    fromStatus: ride.status,
    toStatus: to,
    actorUserId: driverId,
  };
}

async function moveAllRequests(
  tx: Tx,
  rideId: string,
  from: RideRequestStatus,
  to: RideRequestStatus,
  driverId: string,
): Promise<EventRow[]> {
  assertRequestTransition(from, to);
  const moved = await tx
    .update(rideRequests)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(rideRequests.rideId, rideId), eq(rideRequests.status, from)))
    .returning({ id: rideRequests.id });
  return moved.map((r) => requestEvent(r.id, from, to, driverId));
}

// Fares are fixed at start: the discount depends on how many separate requests ride together.
async function startRequests(tx: Tx, rideId: string, driverId: string): Promise<EventRow[]> {
  assertRequestTransition("MATCHED", "IN_PROGRESS");
  const matched = await tx
    .select({ id: rideRequests.id, estimatedFarePaisa: rideRequests.estimatedFarePaisa })
    .from(rideRequests)
    .where(and(eq(rideRequests.rideId, rideId), eq(rideRequests.status, "MATCHED")))
    .orderBy(rideRequests.id)
    .for("update");

  const passengerCount = matched.length;
  if (passengerCount === 0) {
    throw new AppError(409, "RIDE_EMPTY", "Cannot start a ride with no passengers");
  }
  for (const request of matched) {
    await tx
      .update(rideRequests)
      .set({
        status: "IN_PROGRESS",
        finalFarePaisa: finalFarePaisa(request.estimatedFarePaisa, passengerCount),
        updatedAt: sql`now()`,
      })
      .where(and(eq(rideRequests.id, request.id), eq(rideRequests.status, "MATCHED")));
  }
  return matched.map((r) => requestEvent(r.id, "MATCHED", "IN_PROGRESS", driverId));
}

// Runs one transition for the driver's own active ride and returns that ride's id.
function transition(
  driverId: string,
  to: RideStatus,
  moveRequests: (tx: Tx, rideId: string) => Promise<EventRow[]>,
): Promise<string> {
  return db.transaction(async (tx) => {
    const ride = await lockActiveRide(tx, driverId);
    const rideEvent = await moveRide(tx, ride, to, driverId);
    const requestEvents = await moveRequests(tx, ride.id);
    await tx.insert(statusEvents).values([rideEvent, ...requestEvents]);
    return ride.id;
  });
}

export const arriveRide = (driverId: string) =>
  transition(driverId, "DRIVER_ARRIVED", async () => []);

export const startRide = (driverId: string) =>
  transition(driverId, "STARTED", (tx, rideId) => startRequests(tx, rideId, driverId));

export const completeRide = (driverId: string) =>
  transition(driverId, "COMPLETED", (tx, rideId) =>
    moveAllRequests(tx, rideId, "IN_PROGRESS", "COMPLETED", driverId),
  );

export const cancelRide = (driverId: string) =>
  transition(driverId, "CANCELLED", (tx, rideId) =>
    moveAllRequests(tx, rideId, "MATCHED", "CANCELLED", driverId),
  );
