export const BASE_FARE_PAISA = 4000;
export const PER_KM_PAISA = 1500;
export const POOL_DISCOUNT_PERCENT = 20;

function assertPositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer (got ${value})`);
  }
}

export function soloFarePaisa(km: number, seats: number): number {
  assertPositiveInteger("km", km);
  assertPositiveInteger("seats", seats);
  return (BASE_FARE_PAISA + PER_KM_PAISA * km) * seats;
}

// passengerCount is the number of separate ride requests in the ride, not the number of seats.
export function finalFarePaisa(soloFare: number, passengerCount: number): number {
  assertPositiveInteger("soloFare", soloFare);
  assertPositiveInteger("passengerCount", passengerCount);
  if (passengerCount < 2) return soloFare;
  return soloFare - Math.round((soloFare * POOL_DISCOUNT_PERCENT) / 100);
}
