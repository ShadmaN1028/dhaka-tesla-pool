import { and, desc, eq, inArray, ne, notExists, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { areas, rideRequests, rides, statusEvents, users, vehicles } from "../db/schema";
import { claimSeats } from "../domain/pool";
import { arriveRide, cancelRide, completeRide, startRide } from "../domain/rideLifecycle";
import {
  ACTIVE_RIDE_STATUSES,
  assertRequestTransition,
  FINISHED_RIDE_STATUSES,
} from "../domain/stateMachine";
import { AppError } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

const pickupArea = alias(areas, "pickup_area");
const destinationArea = alias(areas, "destination_area");

const idParams = z.object({ id: z.uuid() });

async function assertOnline(driverId: string, action: string) {
  const [driver] = await db
    .select({ isOnline: users.isOnline })
    .from(users)
    .where(eq(users.id, driverId));
  if (!driver?.isOnline) throw new AppError(409, "DRIVER_OFFLINE", `Go online to ${action}`);
}

// A ride with its non-cancelled passengers, or null. Never includes fares.
async function loadRide(where: SQL) {
  const [ride] = await db
    .select({
      id: rides.id,
      status: rides.status,
      capacity: rides.capacity,
      seatsOccupied: rides.seatsOccupied,
      pickupAreaId: pickupArea.id,
      pickupAreaName: pickupArea.name,
      vehicleName: vehicles.name,
    })
    .from(rides)
    .innerJoin(vehicles, eq(rides.vehicleId, vehicles.id))
    .innerJoin(pickupArea, eq(rides.pickupAreaId, pickupArea.id))
    .where(where)
    .limit(1);
  if (!ride) return null;

  const passengers = await db
    .select({
      requestId: rideRequests.id,
      passengerName: users.name,
      seats: rideRequests.seats,
      destinationAreaId: destinationArea.id,
      destinationAreaName: destinationArea.name,
      status: rideRequests.status,
    })
    .from(rideRequests)
    .innerJoin(users, eq(rideRequests.passengerId, users.id))
    .innerJoin(destinationArea, eq(rideRequests.destinationAreaId, destinationArea.id))
    .where(and(eq(rideRequests.rideId, ride.id), ne(rideRequests.status, "CANCELLED")))
    .orderBy(rideRequests.createdAt);

  return {
    id: ride.id,
    status: ride.status,
    capacity: ride.capacity,
    seats_occupied: ride.seatsOccupied,
    pickup_area: { id: ride.pickupAreaId, name: ride.pickupAreaName },
    vehicle_name: ride.vehicleName,
    passengers: passengers.map((p) => ({
      request_id: p.requestId,
      passenger_name: p.passengerName,
      seats: p.seats,
      destination_area: { id: p.destinationAreaId, name: p.destinationAreaName },
      status: p.status,
    })),
  };
}

const currentRide = (driverId: string) =>
  loadRide(and(eq(vehicles.driverId, driverId), inArray(rides.status, ACTIVE_RIDE_STATUSES))!);
const rideById = (rideId: string) => loadRide(eq(rides.id, rideId));

export const driverRouter = Router();

driverRouter.use(requireAuth, requireRole("DRIVER"));

driverRouter.post("/online", async (req, res) => {
  await db.update(users).set({ isOnline: true }).where(eq(users.id, req.user!.id));
  res.json({ is_online: true });
});

driverRouter.post("/offline", async (req, res) => {
  const driverId = req.user!.id;

  await db.transaction(async (tx) => {
    // Take the row lock in its own statement first, so accept (which holds it while it creates a
    // ride) is waited for. The update below then gets a fresh snapshot that already contains that
    // ride; as one statement it would judge "no active ride" from the snapshot taken before the wait.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, driverId)).for("update");

    const activeRide = tx
      .select({ one: sql`1` })
      .from(rides)
      .innerJoin(vehicles, eq(rides.vehicleId, vehicles.id))
      .where(and(eq(vehicles.driverId, driverId), inArray(rides.status, ACTIVE_RIDE_STATUSES)));

    const [updated] = await tx
      .update(users)
      .set({ isOnline: false })
      .where(and(eq(users.id, driverId), notExists(activeRide)))
      .returning({ id: users.id });
    if (!updated) {
      throw new AppError(409, "HAS_ACTIVE_RIDE", "Finish or cancel your active ride before going offline");
    }
  });
  res.json({ is_online: false });
});

driverRouter.get("/requests", async (req, res) => {
  await assertOnline(req.user!.id, "see ride requests");

  const rows = await db
    .select({
      id: rideRequests.id,
      passengerName: users.name,
      seats: rideRequests.seats,
      pickupAreaId: pickupArea.id,
      pickupAreaName: pickupArea.name,
      destinationAreaId: destinationArea.id,
      destinationAreaName: destinationArea.name,
      createdAt: rideRequests.createdAt,
    })
    .from(rideRequests)
    .innerJoin(users, eq(rideRequests.passengerId, users.id))
    .innerJoin(pickupArea, eq(rideRequests.pickupAreaId, pickupArea.id))
    .innerJoin(destinationArea, eq(rideRequests.destinationAreaId, destinationArea.id))
    .where(eq(rideRequests.status, "REQUESTED"))
    .orderBy(rideRequests.createdAt);

  res.json(
    rows.map((r) => ({
      id: r.id,
      passenger_name: r.passengerName,
      seats: r.seats,
      pickup_area: { id: r.pickupAreaId, name: r.pickupAreaName },
      destination_area: { id: r.destinationAreaId, name: r.destinationAreaName },
      created_at: r.createdAt,
    })),
  );
});

driverRouter.post("/requests/:id/accept", validate({ params: idParams }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParams>;
  const driverId = req.user!.id;

  // Keeps the literals below tied to the state machine.
  assertRequestTransition("REQUESTED", "MATCHED");

  await db.transaction(async (tx) => {
    // Locks the driver's row for the whole transaction, so going offline cannot slip in between
    // this check and the ride insert.
    const [driver] = await tx
      .select({ isOnline: users.isOnline })
      .from(users)
      .where(eq(users.id, driverId))
      .for("update");
    if (!driver?.isOnline) throw new AppError(409, "DRIVER_OFFLINE", "Go online to accept requests");

    const [request] = await tx
      .select({ pickupAreaId: rideRequests.pickupAreaId, seats: rideRequests.seats })
      .from(rideRequests)
      .where(eq(rideRequests.id, id));
    if (!request) throw new AppError(404, "NOT_FOUND", "Ride request not found");

    const [vehicle] = await tx
      .select({ id: vehicles.id, capacity: vehicles.capacity })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId));
    if (!vehicle) throw new Error(`Driver ${driverId} has no vehicle`);

    // A driver who already has an active ride trips rides_one_active_per_vehicle_idx here (409).
    const [ride] = await tx
      .insert(rides)
      .values({
        vehicleId: vehicle.id,
        pickupAreaId: request.pickupAreaId,
        status: "OPEN",
        capacity: vehicle.capacity,
        seatsOccupied: 0,
      })
      .returning({ id: rides.id });

    await claimSeats(tx, ride.id, request.seats);

    // Conditional update: only a still-REQUESTED request can be taken. No row rolls everything back.
    const [matched] = await tx
      .update(rideRequests)
      .set({ status: "MATCHED", rideId: ride.id, updatedAt: sql`now()` })
      .where(and(eq(rideRequests.id, id), eq(rideRequests.status, "REQUESTED")))
      .returning({ id: rideRequests.id });
    if (!matched) {
      throw new AppError(409, "REQUEST_UNAVAILABLE", "This request was already taken or cancelled");
    }

    await tx.insert(statusEvents).values([
      { entityType: "RIDE", entityId: ride.id, fromStatus: null, toStatus: "OPEN", actorUserId: driverId },
      {
        entityType: "RIDE_REQUEST",
        entityId: id,
        fromStatus: "REQUESTED",
        toStatus: "MATCHED",
        actorUserId: driverId,
      },
    ]);
  });

  res.json(await currentRide(driverId));
});

driverRouter.get("/ride", async (req, res) => {
  res.json(await currentRide(req.user!.id));
});

driverRouter.post("/ride/arrive", async (req, res) => {
  res.json(await rideById(await arriveRide(req.user!.id)));
});

driverRouter.post("/ride/start", async (req, res) => {
  res.json(await rideById(await startRide(req.user!.id)));
});

driverRouter.post("/ride/complete", async (req, res) => {
  res.json(await rideById(await completeRide(req.user!.id)));
});

driverRouter.post("/ride/cancel", async (req, res) => {
  res.json(await rideById(await cancelRide(req.user!.id)));
});

driverRouter.get("/rides", async (req, res) => {
  const notCancelled = sql`${rideRequests.status} <> 'CANCELLED'`;
  const rows = await db
    .select({
      id: rides.id,
      status: rides.status,
      createdAt: rides.createdAt,
      pickupAreaId: pickupArea.id,
      pickupAreaName: pickupArea.name,
      vehicleName: vehicles.name,
      passengerCount: sql<number>`count(${rideRequests.id}) filter (where ${notCancelled})`.mapWith(
        Number,
      ),
      seatsUsed: sql<number>`coalesce(sum(${rideRequests.seats}) filter (where ${notCancelled}), 0)`.mapWith(
        Number,
      ),
    })
    .from(rides)
    .innerJoin(vehicles, eq(rides.vehicleId, vehicles.id))
    .innerJoin(pickupArea, eq(rides.pickupAreaId, pickupArea.id))
    .leftJoin(rideRequests, eq(rideRequests.rideId, rides.id))
    .where(and(eq(vehicles.driverId, req.user!.id), inArray(rides.status, FINISHED_RIDE_STATUSES)))
    .groupBy(rides.id, pickupArea.id, vehicles.id)
    .orderBy(desc(rides.createdAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      pickup_area: { id: r.pickupAreaId, name: r.pickupAreaName },
      vehicle_name: r.vehicleName,
      passenger_count: r.passengerCount,
      seats_used: r.seatsUsed,
      created_at: r.createdAt,
    })),
  );
});
