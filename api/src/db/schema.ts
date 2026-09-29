import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["PASSENGER", "DRIVER"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  isOnline: boolean("is_online").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .unique()
      .references(() => users.id),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
  },
  (t) => [check("vehicles_capacity_positive", sql`${t.capacity} > 0`)],
);

export const areas = pgTable("areas", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
});

export const areaDistances = pgTable(
  "area_distances",
  {
    fromAreaId: integer("from_area_id")
      .notNull()
      .references(() => areas.id),
    toAreaId: integer("to_area_id")
      .notNull()
      .references(() => areas.id),
    km: integer("km").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromAreaId, t.toAreaId] }),
    check("area_distances_km_positive", sql`${t.km} > 0`),
    check("area_distances_distinct_areas", sql`${t.fromAreaId} <> ${t.toAreaId}`),
  ],
);

export const rideStatus = pgEnum("ride_status", [
  "OPEN",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
]);

export const rideRequestStatus = pgEnum("ride_request_status", [
  "REQUESTED",
  "MATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const statusEntityType = pgEnum("status_entity_type", ["RIDE", "RIDE_REQUEST"]);

// Union of ride_status and ride_request_status: a status event row belongs to either machine.
export const eventStatus = pgEnum("event_status", [
  "OPEN",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
  "REQUESTED",
  "MATCHED",
  "IN_PROGRESS",
]);

export const rides = pgTable(
  "rides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    pickupAreaId: integer("pickup_area_id")
      .notNull()
      .references(() => areas.id),
    status: rideStatus("status").notNull().default("OPEN"),
    capacity: integer("capacity").notNull(),
    seatsOccupied: integer("seats_occupied").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "rides_seats_within_capacity",
      sql`${t.seatsOccupied} >= 0 AND ${t.seatsOccupied} <= ${t.capacity}`,
    ),
    index("rides_status_pickup_area_created_at_idx").on(t.status, t.pickupAreaId, t.createdAt),
    index("rides_vehicle_id_idx").on(t.vehicleId),
  ],
);

export const rideRequests = pgTable(
  "ride_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => users.id),
    rideId: uuid("ride_id").references(() => rides.id),
    pickupAreaId: integer("pickup_area_id")
      .notNull()
      .references(() => areas.id),
    destinationAreaId: integer("destination_area_id")
      .notNull()
      .references(() => areas.id),
    seats: integer("seats").notNull(),
    status: rideRequestStatus("status").notNull().default("REQUESTED"),
    estimatedFarePaisa: integer("estimated_fare_paisa").notNull(),
    finalFarePaisa: integer("final_fare_paisa"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("ride_requests_distinct_areas", sql`${t.pickupAreaId} <> ${t.destinationAreaId}`),
    check("ride_requests_seats_range", sql`${t.seats} BETWEEN 1 AND 3`),
    index("ride_requests_status_pickup_area_created_at_idx").on(
      t.status,
      t.pickupAreaId,
      t.createdAt,
    ),
    index("ride_requests_passenger_id_idx").on(t.passengerId),
  ],
);

export const statusEvents = pgTable(
  "status_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entityType: statusEntityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fromStatus: eventStatus("from_status"),
    toStatus: eventStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_events_entity_idx").on(t.entityType, t.entityId)],
);
