"use strict";

const {
  CACHE_MS,
  HISTORY_POINTS,
  HISTORY_WINDOW_SEC,
  REQUEST_BUCKETS,
  REQUEST_WINDOW_SEC,
  SAMPLE_INTERVAL_SEC,
  TRAFFIC_BUCKETS,
  TRAFFIC_INTERVAL_SEC,
  buildSnapshot,
  buildInsights,
  historyPoint,
  overlayRequestHistory,
  sanitizeHealth,
  summarizeRequests,
  summarizeFederation,
  summarizeTrafficHistory,
  summarizeUploads,
} = require("../../lib/public-status");

describe("privacy-safe federation status", () => {
  test("reports aggregate reachability without peer identity or URLs", () => {
    const summary = summarizeFederation([
      {
        peerId: "private-name",
        baseUrl: "https://secret.example",
        status: "active",
        latencyMs: 40,
      },
      { peerId: "other", status: "unreachable", latencyMs: 90 },
    ], true);
    expect(summary).toEqual({
      enabled: true,
      peers: 2,
      active: 1,
      unavailable: 1,
      status: "degraded",
      latencyMs: 40,
    });
    expect(JSON.stringify(summary)).not.toMatch(/private-name|secret|other/);
  });
});
const {
  formatByteTick,
  niceByteAxis,
  niceNumberAxis,
  smoothPointPath,
} = require("../../common/status-charts");

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
        label: "Database",
        status: "operational",
        latencyMs: 2,
      },
      {
        id: "storage",
        label: "File storage",
        status: "operational",
        latencyMs: 4,
      },
      {
        id: "capacity",
        label: "Drive storage",
        status: "operational",
        latencyMs: 1,
      },
    ]);
    expect(JSON.stringify(safe)).not.toContain("/secret/");
    expect(JSON.stringify(safe)).not.toContain("PONG");
    expect(JSON.stringify(safe)).not.toContain("4321");
  });

  test("status snapshots are reused for the full five-minute sample period", () => {
    expect(SAMPLE_INTERVAL_SEC).toBe(5 * 60);
    expect(CACHE_MS).toBe(SAMPLE_INTERVAL_SEC * 1000);
    expect(HISTORY_WINDOW_SEC).toBe(5 * 24 * 60 * 60);
    expect(HISTORY_POINTS).toBe(1441);
    expect(TRAFFIC_INTERVAL_SEC).toBe(2 * 60 * 60);
    expect(TRAFFIC_BUCKETS).toBe(60);
    expect(REQUEST_WINDOW_SEC).toBe(HISTORY_WINDOW_SEC);
    expect(REQUEST_BUCKETS).toBe(60);
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
          uploadsBytes: 500,
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
    expect(snapshot.activity.totals.uploadsBytes).toBe(500);
    expect(historyPoint(snapshot)).toEqual(
      expect.objectContaining({
        status: "operational",
        storageBytes: 250,
        files: 1,
        rooms: 2,
        usersOnline: 5,
        uploadsBytes: 500,
        requestsOpen: 1,
        requestsFulfilled: 0,
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
    expect(summary.timeline.intervalSec).toBe(2 * 60 * 60);
    expect(summary.timeline.windowSec).toBe(5 * 24 * 60 * 60);
    expect(summary.timeline.points).toHaveLength(60);
    expect(summary.timeline.points.at(-1)).toMatchObject({
      unfulfilled: 2,
      fulfilled: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(JSON.stringify(summary)).not.toContain("secret-room");
  });

  test("traffic history becomes five-day two-hour transfer totals", () => {
    const summary = summarizeTrafficHistory(
      [
        {
          at: "2026-07-28T08:00:00.000Z",
          uploadsBytes: 100,
          downloadsBytes: 200,
          storageBytes: 100,
        },
        {
          at: "2026-07-28T09:00:00.000Z",
          uploadsBytes: 150,
          downloadsBytes: 260,
          storageBytes: 150,
        },
        {
          at: "2026-07-28T11:00:00.000Z",
          uploadsBytes: 450,
          downloadsBytes: 360,
          storageBytes: 450,
        },
      ],
      Date.parse("2026-07-28T12:00:00.000Z"),
      2,
      4 * 60 * 60,
    );
    expect(summary.intervalSec).toBe(2 * 60 * 60);
    expect(summary.points).toEqual([
      {
        at: "2026-07-28T08:00:00.000Z",
        uploadedBytes: 50,
        downloadedBytes: 60,
      },
      {
        at: "2026-07-28T10:00:00.000Z",
        uploadedBytes: 300,
        downloadedBytes: 100,
      },
    ]);
  });

  test("legacy history estimates uploads from positive stored-data changes", () => {
    const summary = summarizeTrafficHistory(
      [
        {
          at: "2026-07-28T10:00:00.000Z",
          storageBytes: 100,
          downloadsBytes: 200,
        },
        {
          at: "2026-07-28T11:00:00.000Z",
          storageBytes: 175,
          downloadsBytes: 225,
        },
      ],
      Date.parse("2026-07-28T12:00:00.000Z"),
      1,
      2 * 60 * 60,
    );
    expect(summary.points[0]).toMatchObject({
      uploadedBytes: 75,
      downloadedBytes: 25,
    });
  });

  test("recorded request snapshots preserve period state", () => {
    const timeline = {
      intervalSec: 7200,
      points: [
        {
          at: "2026-07-28T08:00:00.000Z",
          unfulfilled: 0,
          fulfilled: 0,
        },
        {
          at: "2026-07-28T10:00:00.000Z",
          unfulfilled: 1,
          fulfilled: 0,
        },
      ],
    };
    const overlaid = overlayRequestHistory(timeline, [
      {
        at: "2026-07-28T09:30:00.000Z",
        requestsOpen: 3,
        requestsFulfilled: 2,
      },
    ]);
    expect(overlaid.points[0]).toMatchObject({
      unfulfilled: 3,
      fulfilled: 2,
    });
    expect(overlaid.points[1]).toMatchObject({
      unfulfilled: 1,
      fulfilled: 0,
    });
  });

  test("chart scales use readable round values and smooth paths", () => {
    const bytes = niceByteAxis(73 * 1000 * 1000, 5);
    expect(bytes.step).toBe(20 * 1000 * 1000);
    expect(bytes.max).toBe(80 * 1000 * 1000);
    expect(bytes.ticks.map(formatByteTick)).toEqual([
      "0",
      "20 MB",
      "40 MB",
      "60 MB",
      "80 MB",
    ]);
    expect(niceNumberAxis(11, 4, 1)).toMatchObject({
      step: 5,
      max: 15,
    });
    expect(
      smoothPointPath([
        { x: 0, y: 10 },
        { x: 20, y: 5 },
        { x: 40, y: 8 },
      ]),
    ).toMatch(/^M0,10 C/);
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
