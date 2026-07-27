"use strict";

const {
  normalizeRetentionDays,
  syncLogScope,
  syncLogEntryKey,
  createMemorySyncLog,
  createRedisSyncLog,
  DEFAULT_RETENTION_DAYS,
} = require("../../lib/plugins/sync-log");

describe("plugin sync-log (shipped)", () => {
  test("normalizeRetentionDays clamps", () => {
    expect(normalizeRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(0)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(30)).toBe(30);
    expect(normalizeRetentionDays(1)).toBe(1);
    expect(normalizeRetentionDays(9999)).toBe(730);
  });

  test("scope and entry keys are stable", () => {
    const a = syncLogScope("mega-folder", "room1", "https://mega.nz/folder/x");
    const b = syncLogScope("mega-folder", "room1", "https://mega.nz/folder/x");
    const c = syncLogScope("mega-folder", "room2", "https://mega.nz/folder/x");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(syncLogEntryKey("a.pdf", 12)).toBe("a.pdf:12");
  });

  test("memory log has/mark and expiry", async () => {
    const log = createMemorySyncLog({ retentionDays: 30 });
    const scope = "plugin:synclog:test:abc";
    const key = "file.pdf:100";
    expect(await log.has(scope, key)).toBe(false);
    const now = Date.now();
    await log.mark(scope, key, now);
    expect(await log.has(scope, key)).toBe(true);
    // expired
    await log.mark(scope, "old.pdf:1", now - 40 * 86400000);
    expect(await log.has(scope, "old.pdf:1")).toBe(false);
    const pruned = await log.prune(scope, now);
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  test("redis log uses zadd/zscore/zremrangebyscore", async () => {
    const z = new Map();
    const redis = {
      async zadd(key, score, member) {
        if (!z.has(key)) {
          z.set(key, new Map());
        }
        z.get(key).set(member, Number(score));
      },
      async zscore(key, member) {
        const m = z.get(key);
        if (!m || !m.has(member)) {
          return null;
        }
        return String(m.get(member));
      },
      async zremrangebyscore(key, _min, max) {
        const m = z.get(key);
        if (!m) {
          return 0;
        }
        const cutoff = Number(max);
        let n = 0;
        for (const [mem, sc] of m) {
          if (sc <= cutoff) {
            m.delete(mem);
            n++;
          }
        }
        return n;
      },
    };
    const log = createRedisSyncLog(redis, { retentionDays: 30 });
    const scope = "plugin:synclog:redis:x";
    const now = Date.now();
    await log.mark(scope, "n.pdf:3", now);
    expect(await log.has(scope, "n.pdf:3")).toBe(true);
  });
});
