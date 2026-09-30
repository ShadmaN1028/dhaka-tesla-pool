import { describe, expect, it } from "vitest";
import {
  BASE_FARE_PAISA,
  finalFarePaisa,
  PER_KM_PAISA,
  POOL_DISCOUNT_PERCENT,
  soloFarePaisa,
} from "../src/domain/fare";

describe("fare constants", () => {
  it("match the fare model", () => {
    expect(BASE_FARE_PAISA).toBe(4000);
    expect(PER_KM_PAISA).toBe(1500);
    expect(POOL_DISCOUNT_PERCENT).toBe(20);
  });
});

describe("worked example", () => {
  it("Nusrat, Banani → Mohakhali (3 km, 1 seat): solo 8500, pooled with Rafiq 6800", () => {
    const solo = soloFarePaisa(3, 1);
    expect(solo).toBe(8500);
    expect(finalFarePaisa(solo, 2)).toBe(6800);
  });

  it("Rafiq, Banani → Gulshan 1 (2 km, 1 seat): solo 7000, pooled with Nusrat 5600", () => {
    const solo = soloFarePaisa(2, 1);
    expect(solo).toBe(7000);
    expect(finalFarePaisa(solo, 2)).toBe(5600);
  });
});

describe("pool discount", () => {
  it("is not applied when the passenger rides alone", () => {
    expect(finalFarePaisa(8500, 1)).toBe(8500);
    expect(finalFarePaisa(7000, 1)).toBe(7000);
  });

  it("counts passengers, not seats: 2 seats, 3 km, alone is 17000 with no discount", () => {
    const solo = soloFarePaisa(3, 2);
    expect(solo).toBe(17000);
    expect(finalFarePaisa(solo, 1)).toBe(17000);
  });

  it("is a flat 20% however many passengers share the ride", () => {
    expect(finalFarePaisa(17000, 2)).toBe(13600);
    expect(finalFarePaisa(8500, 3)).toBe(6800);
  });

  it("rounds the discount to a whole paisa", () => {
    expect(finalFarePaisa(8501, 2)).toBe(6801); // discount 1700.2 → 1700
    expect(finalFarePaisa(8503, 2)).toBe(6802); // discount 1700.6 → 1701
  });

  it("always yields whole paisa", () => {
    for (let km = 1; km <= 16; km++) {
      for (let seats = 1; seats <= 3; seats++) {
        const solo = soloFarePaisa(km, seats);
        expect(Number.isInteger(solo)).toBe(true);
        for (let passengers = 1; passengers <= 3; passengers++) {
          expect(Number.isInteger(finalFarePaisa(solo, passengers))).toBe(true);
        }
      }
    }
  });
});

describe("invalid input", () => {
  it.each([
    ["0 km", 0, 1],
    ["negative km", -3, 1],
    ["non-integer km", 2.5, 1],
    ["NaN km", NaN, 1],
    ["0 seats", 3, 0],
    ["negative seats", 3, -1],
    ["non-integer seats", 3, 1.5],
  ])("soloFarePaisa throws for %s", (_label, km, seats) => {
    expect(() => soloFarePaisa(km, seats)).toThrow(RangeError);
  });

  it.each([
    ["0 solo fare", 0, 2],
    ["non-integer solo fare", 8500.5, 2],
    ["0 passengers", 8500, 0],
    ["non-integer passengers", 8500, 1.5],
  ])("finalFarePaisa throws for %s", (_label, soloFare, passengers) => {
    expect(() => finalFarePaisa(soloFare, passengers)).toThrow(RangeError);
  });
});
