"use strict";

const {
  selectCandidate,
  getVolume,
} = require("../../lib/storage-volumes");

function volume(id, usedPercent, role = "primary", weight = 1) {
  return {
    id,
    usedPercent,
    role,
    weight,
    free: 1000 - usedPercent,
  };
}

describe("multi-volume storage placement", () => {
  test("legacy storage always resolves to the uploads directory", () => {
    expect(getVolume("legacy").id).toBe("legacy");
    expect(getVolume("legacy").path).toMatch(/uploads$/);
  });

  test("balanced placement chooses the lowest weighted fill", () => {
    const selected = selectCandidate(
      { policy: "balanced", fallbackThreshold: 75 },
      [volume("fuller", 60), volume("roomier", 30)],
    );
    expect(selected.id).toBe("roomier");
  });

  test("weights allow larger volumes to absorb proportionally more data", () => {
    const selected = selectCandidate(
      { policy: "balanced", fallbackThreshold: 75 },
      [volume("small", 30, "primary", 1), volume("large", 45, "primary", 2)],
    );
    expect(selected.id).toBe("large");
  });

  test("primary-then-fallback changes tiers at the configured threshold", () => {
    const config = {
      policy: "primary-then-fallback",
      fallbackThreshold: 75,
    };
    expect(
      selectCandidate(config, [
        volume("primary", 74),
        volume("fallback", 5, "fallback"),
      ]).id,
    ).toBe("primary");
    expect(
      selectCandidate(config, [
        volume("primary", 75),
        volume("fallback", 5, "fallback"),
      ]).id,
    ).toBe("fallback");
  });

  test("balanced placement keeps fallback idle while a primary is below threshold", () => {
    expect(
      selectCandidate(
        { policy: "balanced", fallbackThreshold: 75 },
        [
          volume("primary", 70),
          volume("fallback", 5, "fallback"),
        ],
      ).id,
    ).toBe("primary");
  });

  test("fails closed when no volume can accept a write", () => {
    expect(() =>
      selectCandidate(
        { policy: "balanced", fallbackThreshold: 75 },
        [],
      ),
    ).toThrow(/No writable storage volume/);
  });
});
