CREATE TYPE "public"."event_status" AS ENUM('OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED', 'REQUESTED', 'MATCHED', 'IN_PROGRESS');--> statement-breakpoint
CREATE TYPE "public"."ride_request_status" AS ENUM('REQUESTED', 'MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_entity_type" AS ENUM('RIDE', 'RIDE_REQUEST');--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"ride_id" uuid,
	"pickup_area_id" integer NOT NULL,
	"destination_area_id" integer NOT NULL,
	"seats" integer NOT NULL,
	"status" "ride_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"estimated_fare_paisa" integer NOT NULL,
	"final_fare_paisa" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_requests_distinct_areas" CHECK ("ride_requests"."pickup_area_id" <> "ride_requests"."destination_area_id"),
	CONSTRAINT "ride_requests_seats_range" CHECK ("ride_requests"."seats" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_area_id" integer NOT NULL,
	"status" "ride_status" DEFAULT 'OPEN' NOT NULL,
	"capacity" integer NOT NULL,
	"seats_occupied" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_seats_within_capacity" CHECK ("rides"."seats_occupied" >= 0 AND "rides"."seats_occupied" <= "rides"."capacity")
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" "status_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_status" "event_status",
	"to_status" "event_status" NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_area_id_areas_id_fk" FOREIGN KEY ("pickup_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_destination_area_id_areas_id_fk" FOREIGN KEY ("destination_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_pickup_area_id_areas_id_fk" FOREIGN KEY ("pickup_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_requests_status_pickup_area_created_at_idx" ON "ride_requests" USING btree ("status","pickup_area_id","created_at");--> statement-breakpoint
CREATE INDEX "ride_requests_passenger_id_idx" ON "ride_requests" USING btree ("passenger_id");--> statement-breakpoint
CREATE INDEX "rides_status_pickup_area_created_at_idx" ON "rides" USING btree ("status","pickup_area_id","created_at");--> statement-breakpoint
CREATE INDEX "rides_vehicle_id_idx" ON "rides" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "status_events_entity_idx" ON "status_events" USING btree ("entity_type","entity_id");