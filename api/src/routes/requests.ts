import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import {
  areaDistances,
  areas,
  rideRequests,
  rides,
  statusEvents,
  users,
  vehicles,
} from "../db/schema";
import { soloFarePaisa } from "../domain/fare";
import { assertRequestTransition, CANCELLABLE_REQUEST_STATUSES } from "../domain/stateMachine";
import { AppError } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

const areaId = z.int().positive().max(2_147_483_647);

const createBody = z
  .object({
    pickup_area_id: areaId,
    destination_area_id: areaId,
    seats: z.int().min(1).max(3),
  })
  .refine((b) => b.pickup_area_id !== b.destination_area_id, {
    message: "pickup and destination must be different areas",
    path: ["destination_area_id"],
  });

const idParams = z.object({ id: z.uuid() });

const pickupArea = alias(areas, "pickup_area");
const destinationArea = alias(areas, "destination_area");

// Always scoped to one passenger: there is no way to read another passenger's request.
async function selectOwnRequests(passengerId: string, requestId?: string) {
  const owned = eq(rideRequests.passengerId, passengerId);
  return db
    .select({
      id: rideRequests.id,
      status: rideRequests.status,
      seats: rideRequests.seats,
      estimatedFarePaisa: rideRequests.estimatedFarePaisa,
      finalFarePaisa: rideRequests.finalFarePaisa,
      rideId: rideRequests.rideId,
      createdAt: rideRequests.createdAt,
      pickupAreaId: pickupArea.id,
      pickupAreaName: pickupArea.name,
      destinationAreaId: destinationArea.id,
      destinationAreaName: destinationArea.name,
      driverName: users.name,
      vehicleName: vehicles.name,
    })
    .from(rideRequests)
    .innerJoin(pickupArea, eq(rideRequests.pickupAreaId, pickupArea.id))
    .innerJoin(destinationArea, eq(rideRequests.destinationAreaId, destinationArea.id))
    .leftJoin(rides, eq(rideRequests.rideId, rides.id))
    .leftJoin(vehicles, eq(rides.vehicleId, vehicles.id))
    .leftJoin(users, eq(vehicles.driverId, users.id))
    .where(requestId ? and(owned, eq(rideRequests.id, requestId)) : owned)
    .orderBy(desc(rideRequests.createdAt));
}

type RequestRow = Awaited<ReturnType<typeof selectOwnRequests>>[number];

const toResponse = (row: RequestRow) => ({
  id: row.id,
  status: row.status,
  seats: row.seats,
  pickup_area: { id: row.pickupAreaId, name: row.pickupAreaName },
  destination_area: { id: row.destinationAreaId, name: row.destinationAreaName },
  estimated_fare_paisa: row.estimatedFarePaisa,
  final_fare_paisa: row.finalFarePaisa,
  ride_id: row.rideId,
  created_at: row.createdAt,
  driver:
    row.driverName && row.vehicleName ? { name: row.driverName, vehicle: row.vehicleName } : null,
});

const unknownArea = (field: string) =>
  new AppError(400, "VALIDATION_ERROR", `body.${field}: unknown area`);

export const requestsRouter = Router();

requestsRouter.use(requireAuth, requireRole("PASSENGER"));

requestsRouter.post("/", validate({ body: createBody }), async (req, res) => {
  const passengerId = req.user!.id;
  const body = req.body as z.infer<typeof createBody>;
  const pickupAreaId = body.pickup_area_id;
  const destinationAreaId = body.destination_area_id;

  const found = await db
    .select({ id: areas.id })
    .from(areas)
    .where(inArray(areas.id, [pickupAreaId, destinationAreaId]));
  const knownAreaIds = new Set(found.map((a) => a.id));
  if (!knownAreaIds.has(pickupAreaId)) throw unknownArea("pickup_area_id");
  if (!knownAreaIds.has(destinationAreaId)) throw unknownArea("destination_area_id");

  const [distance] = await db
    .select({ km: areaDistances.km })
    .from(areaDistances)
    .where(
      and(
        eq(areaDistances.fromAreaId, pickupAreaId),
        eq(areaDistances.toAreaId, destinationAreaId),
      ),
    );
  if (!distance) {
    throw new Error(`No area_distances row for areas ${pickupAreaId} -> ${destinationAreaId}`);
  }

  const requestId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rideRequests)
      .values({
        passengerId,
        pickupAreaId,
        destinationAreaId,
        seats: body.seats,
        status: "REQUESTED",
        estimatedFarePaisa: soloFarePaisa(distance.km, body.seats),
      })
      .returning({ id: rideRequests.id });
    await tx.insert(statusEvents).values({
      entityType: "RIDE_REQUEST",
      entityId: created.id,
      fromStatus: null,
      toStatus: "REQUESTED",
      actorUserId: passengerId,
    });
    return created.id;
  });

  const [row] = await selectOwnRequests(passengerId, requestId);
  res.status(201).json(toResponse(row));
});

requestsRouter.get("/", async (req, res) => {
  const rows = await selectOwnRequests(req.user!.id);
  res.json(rows.map(toResponse));
});

requestsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParams>;
  const [row] = await selectOwnRequests(req.user!.id, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Ride request not found");
  res.json(toResponse(row));
});

requestsRouter.post("/:id/cancel", validate({ params: idParams }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParams>;
  const passengerId = req.user!.id;

  await db.transaction(async (tx) => {
    // One atomic conditional statement. The FOR UPDATE subquery only exists to hand back the
    // status the request had before this update, since RETURNING alone gives the new row.
    const previous = tx
      .select({ id: rideRequests.id, status: rideRequests.status })
      .from(rideRequests)
      .where(
        and(
          eq(rideRequests.id, id),
          eq(rideRequests.passengerId, passengerId),
          inArray(rideRequests.status, CANCELLABLE_REQUEST_STATUSES),
        ),
      )
      .for("update")
      .as("previous");

    const [cancelled] = await tx
      .update(rideRequests)
      .set({ status: "CANCELLED", updatedAt: sql`now()` })
      .from(previous)
      .where(eq(rideRequests.id, previous.id))
      .returning({
        rideId: rideRequests.rideId,
        seats: rideRequests.seats,
        previousStatus: previous.status,
      });

    if (!cancelled) {
      const [current] = await tx
        .select({ status: rideRequests.status })
        .from(rideRequests)
        .where(and(eq(rideRequests.id, id), eq(rideRequests.passengerId, passengerId)));
      if (!current) throw new AppError(404, "NOT_FOUND", "Ride request not found");
      assertRequestTransition(current.status, "CANCELLED");
      // Unreachable: statuses only move forward, so a request that was cancellable when the
      // update ran cannot be cancellable again now.
      throw new Error(`Cancel matched no row for a ${current.status} request`);
    }

    if (cancelled.previousStatus === "MATCHED" && cancelled.rideId) {
      await tx
        .update(rides)
        .set({
          seatsOccupied: sql`${rides.seatsOccupied} - ${cancelled.seats}`,
          updatedAt: sql`now()`,
        })
        .where(eq(rides.id, cancelled.rideId));
    }

    await tx.insert(statusEvents).values({
      entityType: "RIDE_REQUEST",
      entityId: id,
      fromStatus: cancelled.previousStatus,
      toStatus: "CANCELLED",
      actorUserId: passengerId,
    });
  });

  const [row] = await selectOwnRequests(passengerId, id);
  res.json(toResponse(row));
});
