import { describe, expect, it } from "vitest";
import { rideRequestStatus, rideStatus } from "../src/db/schema";
import {
  ACTIVE_RIDE_STATUSES,
  assertRequestTransition,
  assertRideTransition,
  CANCELLABLE_REQUEST_STATUSES,
  FINISHED_RIDE_STATUSES,
  type RideRequestStatus,
  type RideStatus,
} from "../src/domain/stateMachine";
import { AppError } from "../src/errors";

function expectInvalid(call: () => void, message: string) {
  let error: unknown;
  try {
    call();
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect([appError.status, appError.code, appError.message]).toEqual([
    409,
    "INVALID_TRANSITION",
    message,
  ]);
}

function describeMachine<S extends string>(machine: {
  entity: string;
  assertTransition: (from: S, to: S) => void;
  statuses: readonly S[];
  terminal: S[];
  valid: [S, S][];
  invalid: [S, S][];
}) {
  const { entity, assertTransition, statuses, terminal, valid, invalid } = machine;
  const invalidMessage = (from: S, to: S) => `Cannot move ${entity} from ${from} to ${to}`;

  describe(`${entity} state machine`, () => {
    it.each(valid)("allows %s → %s", (from, to) => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it.each(invalid)("rejects %s → %s with 409 INVALID_TRANSITION", (from, to) => {
      expectInvalid(() => assertTransition(from, to), invalidMessage(from, to));
    });

    it.each(terminal)("%s is terminal: it cannot move to any status", (from) => {
      for (const to of statuses) {
        expectInvalid(() => assertTransition(from, to), invalidMessage(from, to));
      }
    });

    it("allows exactly the listed transitions and nothing else", () => {
      for (const from of statuses) {
        for (const to of statuses) {
          const listed = valid.some(([f, t]) => f === from && t === to);
          if (listed) {
            expect(() => assertTransition(from, to)).not.toThrow();
          } else {
            expectInvalid(() => assertTransition(from, to), invalidMessage(from, to));
          }
        }
      }
    });
  });
}

describeMachine<RideRequestStatus>({
  entity: "ride request",
  assertTransition: assertRequestTransition,
  statuses: rideRequestStatus.enumValues,
  terminal: ["COMPLETED", "CANCELLED"],
  valid: [
    ["REQUESTED", "MATCHED"],
    ["MATCHED", "IN_PROGRESS"],
    ["IN_PROGRESS", "COMPLETED"],
    ["REQUESTED", "CANCELLED"],
    ["MATCHED", "CANCELLED"],
  ],
  invalid: [
    ["COMPLETED", "MATCHED"],
    ["COMPLETED", "REQUESTED"],
    ["CANCELLED", "REQUESTED"],
    ["CANCELLED", "MATCHED"],
    ["REQUESTED", "IN_PROGRESS"],
    ["REQUESTED", "COMPLETED"],
    ["MATCHED", "COMPLETED"],
    ["MATCHED", "REQUESTED"],
    ["IN_PROGRESS", "CANCELLED"],
    ["REQUESTED", "REQUESTED"],
  ],
});

describeMachine<RideStatus>({
  entity: "ride",
  assertTransition: assertRideTransition,
  statuses: rideStatus.enumValues,
  terminal: ["COMPLETED", "CANCELLED"],
  valid: [
    ["OPEN", "DRIVER_ARRIVED"],
    ["DRIVER_ARRIVED", "STARTED"],
    ["STARTED", "COMPLETED"],
    ["OPEN", "CANCELLED"],
    ["DRIVER_ARRIVED", "CANCELLED"],
  ],
  invalid: [
    ["COMPLETED", "OPEN"],
    ["COMPLETED", "STARTED"],
    ["CANCELLED", "OPEN"],
    ["CANCELLED", "DRIVER_ARRIVED"],
    ["OPEN", "STARTED"],
    ["OPEN", "COMPLETED"],
    ["DRIVER_ARRIVED", "COMPLETED"],
    ["DRIVER_ARRIVED", "OPEN"],
    ["STARTED", "CANCELLED"],
    ["STARTED", "OPEN"],
    ["OPEN", "OPEN"],
  ],
});

describe("CANCELLABLE_REQUEST_STATUSES", () => {
  it("lists exactly the request statuses that may move to CANCELLED", () => {
    expect(CANCELLABLE_REQUEST_STATUSES).toEqual(["REQUESTED", "MATCHED"]);
  });
});

describe("ride status groups", () => {
  it("ACTIVE_RIDE_STATUSES are the statuses that can still move", () => {
    expect(ACTIVE_RIDE_STATUSES).toEqual(["OPEN", "DRIVER_ARRIVED", "STARTED"]);
  });

  it("FINISHED_RIDE_STATUSES are the terminal statuses", () => {
    expect(FINISHED_RIDE_STATUSES).toEqual(["COMPLETED", "CANCELLED"]);
  });
});
