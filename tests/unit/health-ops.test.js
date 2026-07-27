"use strict";

/**
 * Observability health() — deeper ops signals.
 * Uses the real module; Redis check may fail if Redis is down (ok still defined).
 */

const OBS = require("../../lib/observability");

describe("observability.health (shipped)", () => {
  test("health returns ok boolean and redis/storage/disk/previewQueue checks", async () => {
    const h = await OBS.health();
    expect(typeof h.ok).toBe("boolean");
    expect(h.now).toBeTruthy();
    expect(h.checks).toBeTruthy();
    expect(h.checks.redis).toBeTruthy();
    expect(typeof h.checks.redis.ok).toBe("boolean");
    expect(h.checks.storage).toBeTruthy();
    expect(typeof h.checks.storage.ok).toBe("boolean");
    expect(h.checks.disk).toBeTruthy();
    expect(h.checks.previewQueue).toBeTruthy();
    expect(typeof h.checks.previewQueue.pending).toBe("number");
    expect(h.metrics).toBeTruthy();
    expect(typeof h.uptimeSec).toBe("number");
  }, 15000);

  test("setPreviewQueue updates pending/active reported by health", async () => {
    OBS.setPreviewQueue({ pending: 3, active: 1 });
    const h = await OBS.health();
    expect(h.checks.previewQueue.pending).toBe(3);
    expect(h.checks.previewQueue.active).toBe(1);
  }, 15000);
});
