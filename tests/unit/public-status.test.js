"use strict";

const {
  buildSnapshot,
  buildInsights,
  historyPoint,
  sanitizeHealth,
  summarizeRequests,
  summarizeUploads,
} = require("../../lib/public-status");

function health(overrides = {}) {
  return Object.assign(
    {
      ok: true,
      now: "2026-07-28T12:00:00.000Z",
      uptimeSec: 86461,
      pid: 4321,
      checks: {
        redis: {
          ok: true,
          latencyMs: 2,
          detail: "PONG",
          path: "/secret/redis",
        },
        storage: {
          ok: true,
          latencyMs: 4,
          path: "/secret/uploads",
        },
        disk: {
          ok: true,
          latencyMs: 1,
          path: "/secret/uploads",
          totalBytes: 1000,
          freeBytes: 400,
        },
        previewQueue: {
          ok: true,
          pending: 2,
          active: 1,
          lastFailureAt: null,
        },
      },
    },
    overrides,
  );
}

describe("public status aggregation", () => {
  test("health sanitizer exposes state and latency without internal details", () => {
    const safe = sanitizeHealth(health());
    expect(safe.status).toBe("operational");
    expect(safe.components).toEqual([
      {
        id: "database",
        label: "Realtime database",
        status: "operational",
        latencyMs: 2,
      },
      {
        id: "storage",
        label: "Upload storage",
        status: "operational",
        latencyMs: 4,
      },
      {
        id: "capacity",
        label: "Drive capacity",
        status: "operational",
        latencyMs: 1,
      },
    ]);
    expect(JSON.stringify(safe)).not.toContain("/secret/");
    expect(JSON.stringify(safe)).not.toContain("PONG");
    expect(JSON.stringify(safe)).not.toContain("4321");
  });

  test("snapshot contains aggregate values and no room, user, file, or path identity", () => {
    const snapshot = buildSnapshot({
      now: new Date("2026-07-28T12:00:00.000Z"),
      health: health(),
      rooms: [
        {
          roomid: "private-room-id",
          name: "Secret Room",
          users: 3,
          owners: ["Alice"],
        },
        { roomid: "another-room", name: "Another Secret", users: 2 },
      ],
      uploads: [
        {
          name: "private-filename.pdf",
          roomid: "private-room-id",
          size: 250,
          expired: false,
          tags: { user: "Alice" },
        },
        {
          name: "expired-secret.zip",
          roomid: "another-room",
          size: 900,
          expired: true,
        },
      ],
      requests: [
        {
          name: "secret request",
          roomid: "private-room-id",
          status: "open",
          uploaded: Date.parse("2026-07-28T11:30:00.000Z"),
          expires: Date.parse("2026-07-29T11:30:00.000Z"),
        },
      ],
      registeredUsers: 8,
      persisted: {
        startedAt: "2026-07-28T10:00:00.000Z",
        totals: {
          downloadsServed: 11,
          downloadsBytes: 700,
          uploadsCreated: 4,
        },
      },
    });

    expect(snapshot.capacity.disk).toEqual({
      totalBytes: 1000,
      freeBytes: 400,
      usedBytes: 600,
      usedPercent: 60,
    });
    expect(snapshot.capacity.uploads).toEqual({ files: 1, logicalBytes: 250 });
    expect(snapshot.community).toEqual({
      rooms: 2,
      usersOnline: 5,
      registeredUsers: 8,
    });
    expect(snapshot.activity.totals.downloadsServed).toBe(11);
    expect(historyPoint(snapshot)).toEqual(
      expect.objectContaining({
        status: "operational",
        storageBytes: 250,
        files: 1,
        rooms: 2,
        usersOnline: 5,
      }),
    );

    const publicJSON = JSON.stringify(snapshot);
    for (const secret of [
      "private-room-id",
      "Secret Room",
      "Alice",
      "private-filename.pdf",
      "expired-secret.zip",
      "secret request",
      "/secret/uploads",
      "4321",
    ]) {
      expect(publicJSON).not.toContain(secret);
    }
  });

  test("upload summary excludes expired items", () => {
    expect(
      summarizeUploads([
        { size: 12, expired: false },
        { size: 18, expired: false },
        { size: 99, expired: true },
      ]),
    ).toEqual({ files: 2, logicalBytes: 30 });
  });

  test("request summary exposes only aggregate global flow and timing", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const summary = summarizeRequests(
      [
        {
          name: "private open request",
          roomid: "secret-room",
          status: "open",
          uploaded: Date.parse("2026-07-28T11:20:00.000Z"),
          expires: Date.parse("2026-07-29T12:00:00.000Z"),
          claimedUntil: Date.parse("2026-07-28T12:05:00.000Z"),
        },
        {
          name: "private fulfilled request",
          roomid: "another-secret-room",
          status: "fulfilled",
          uploaded: Date.parse("2026-07-28T09:00:00.000Z"),
          fulfilledAt: Date.parse("2026-07-28T10:00:00.000Z"),
          expires: Date.parse("2026-07-29T12:00:00.000Z"),
        },
        {
          name: "expired request",
          status: "open",
          uploaded: Date.parse("2026-07-27T09:00:00.000Z"),
          expires: Date.parse("2026-07-28T11:00:00.000Z"),
        },
      ],
      now,
    );

    expect(summary.current).toEqual({
      total: 2,
      open: 1,
      fulfilled: 1,
      activeClaims: 1,
      fulfillmentPercent: 50,
      medianFulfillmentSec: 3600,
      oldestOpenSec: 2400,
    });
    expect(summary.last24h).toEqual({ opened: 2, fulfilled: 1 });
    expect(summary.timeline.points).toHaveLength(24);
    expect(
      summary.timeline.points.reduce((sum, point) => sum + point.opened, 0),
    ).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(JSON.stringify(summary)).not.toContain("secret-room");
  });

  test("operational insights derive privacy-safe efficiency ratios", () => {
    expect(
      buildInsights({
        totals: {
          downloadsServed: 8,
          downloadsBytes: 4000,
          uploadsCreated: 4,
          previewFailures: 2,
        },
        uploads: { files: 12 },
        rooms: 3,
      }),
    ).toEqual({
      averageDownloadBytes: 500,
      downloadsPerUpload: 2,
      filesPerRoom: 4,
      previewFailures: 2,
    });
  });

  test("drive-only failure degrades status while storage outage marks outage", () => {
    const degraded = health();
    degraded.checks.disk.ok = false;
    expect(sanitizeHealth(degraded).status).toBe("degraded");

    const outage = health();
    outage.checks.storage.ok = false;
    expect(sanitizeHealth(outage).status).toBe("outage");
  });
});
