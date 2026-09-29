CREATE TYPE "public"."user_role" AS ENUM('PASSENGER', 'DRIVER');--> statement-breakpoint
CREATE TABLE "area_distances" (
	"from_area_id" integer NOT NULL,
	"to_area_id" integer NOT NULL,
	"km" integer NOT NULL,
	CONSTRAINT "area_distances_from_area_id_to_area_id_pk" PRIMARY KEY("from_area_id","to_area_id"),
	CONSTRAINT "area_distances_km_positive" CHECK ("area_distances"."km" > 0),
	CONSTRAINT "area_distances_distinct_areas" CHECK ("area_distances"."from_area_id" <> "area_distances"."to_area_id")
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "areas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "areas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "vehicles_driver_id_unique" UNIQUE("driver_id"),
	CONSTRAINT "vehicles_capacity_positive" CHECK ("vehicles"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "area_distances" ADD CONSTRAINT "area_distances_from_area_id_areas_id_fk" FOREIGN KEY ("from_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_distances" ADD CONSTRAINT "area_distances_to_area_id_areas_id_fk" FOREIGN KEY ("to_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;