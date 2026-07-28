"use strict";

const {
  availabilitySegments,
  availabilitySummary,
  normalizeStatus,
} = require("../../common/status-history");

describe("status availability history", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  test("builds a stable segmented 24-hour window", () => {
    const segments = availabilitySegments(
      [
        {
          at: "2026-07-28T11:50:00.000Z",
          status: "operational",
        },
      ],
      now,
    );
    expect(segments).toHaveLength(48);
    expect(segments.at(-1)).toEqual(
      expect.objectContaining({
        status: "operational",
        samples: 1,
      }),
    );
    expect(segments[0].status).toBe("unknown");
  });

  test("uses the worst recorded status when a segment has several samples", () => {
    const segments = availabilitySegments(
      [
        { at: "2026-07-28T11:40:00.000Z", status: "operational" },
        { at: "2026-07-28T11:45:00.000Z", status: "degraded" },
        { at: "2026-07-28T11:49:00.000Z", status: "outage" },
      ],
      now,
    );
    expect(segments.at(-1).status).toBe("outage");
    expect(segments.at(-1).samples).toBe(3);
  });

  test("does not paint missing or legacy samples as operational", () => {
    const segments = availabilitySegments(
      [
        { at: "2026-07-28T11:50:00.000Z" },
        { at: "2026-07-27T11:50:00.000Z", status: "operational" },
      ],
      now,
    );
    expect(segments.every(segment => segment.status === "unknown")).toBe(true);
    expect(availabilitySummary(segments)).toEqual({
      knownSegments: 0,
      operationalPercent: null,
    });
  });

  test("summarizes only periods with actual observations", () => {
    expect(
      availabilitySummary([
        { status: "operational" },
        { status: "operational" },
        { status: "degraded" },
        { status: "unknown" },
      ]),
    ).toEqual({
      knownSegments: 3,
      operationalPercent: 66.7,
    });
    expect(normalizeStatus("not-a-real-state")).toBe("unknown");
  });
});
