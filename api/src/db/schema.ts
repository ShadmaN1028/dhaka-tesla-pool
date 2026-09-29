import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
