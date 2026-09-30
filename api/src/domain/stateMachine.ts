import type { rideRequestStatus, rideStatus } from "../db/schema";
import { AppError } from "../errors";

export type RideRequestStatus = (typeof rideRequestStatus.enumValues)[number];
export type RideStatus = (typeof rideStatus.enumValues)[number];

// Keyed by every status, so a new enum value is a compile error until it is handled here.
const REQUEST_TRANSITIONS: Record<RideRequestStatus, readonly RideRequestStatus[]> = {
  REQUESTED: ["MATCHED", "CANCELLED"],
  MATCHED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const RIDE_TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  OPEN: ["DRIVER_ARRIVED", "CANCELLED"],
  DRIVER_ARRIVED: ["STARTED", "CANCELLED"],
  STARTED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

function assertTransition<S extends string>(
  transitions: Record<S, readonly S[]>,
  entity: string,
  from: S,
  to: S,
) {
  if (!transitions[from].includes(to)) {
    throw new AppError(409, "INVALID_TRANSITION", `Cannot move ${entity} from ${from} to ${to}`);
  }
}

export function assertRequestTransition(from: RideRequestStatus, to: RideRequestStatus) {
  assertTransition(REQUEST_TRANSITIONS, "ride request", from, to);
}

export function assertRideTransition(from: RideStatus, to: RideStatus) {
  assertTransition(RIDE_TRANSITIONS, "ride", from, to);
}
