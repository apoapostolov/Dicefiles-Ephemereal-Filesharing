"use strict";

const {
  expectedReservation,
} = require("../../lib/storage-reservations");

describe("storage reservations", () => {
  test("uses the exact known upload size", () => {
    expect(expectedReservation(123456)).toBe(123456);
  });

  test("unknown uploads receive a conservative non-zero reservation", () => {
    expect(expectedReservation(0)).toBeGreaterThanOrEqual(1024 * 1024);
  });
});
