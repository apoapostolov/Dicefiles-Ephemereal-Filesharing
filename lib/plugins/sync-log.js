"use strict";

/**
 * Durable log of files already synced by plugins (skip re-download).
 *
 * Retention is global app config `pluginSyncLogRetentionDays` (default 30).
 * Storage: Redis ZSET per scope (score = syncedAt ms, member = dedupe key).
 * Tests inject a memory log via createMemorySyncLog().
 */

const crypto = require("crypto");

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365 * 2;

/**
 * @param {unknown} raw
 * @param {number} [fallback]
 * @returns {number}
 */
function normalizeRetentionDays(raw, fallback) {
  const fb =
    Number.isFinite(Number(fallback)) && Number(fallback) > 0 ?
      Math.floor(Number(fallback)) :
      DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fb;
  }
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(n)));
}

/**
 * Stable scope id for a plugin room+folder (or other import source).
 * @param {string} pluginId
 * @param {string} roomId
 * @param {string} sourceKey — e.g. Mega.nz folder URL
 */
function syncLogScope(pluginId, roomId, sourceKey) {
  const raw = `${pluginId || "plugin"}|${roomId || ""}|${sourceKey || ""}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return `plugin:synclog:${pluginId || "p"}:${hash}`;
}

/**
 * Dedupe key for a folder entry (name after prefix + size).
 * @param {string} name
 * @param {number|string|null|undefined} size
 */
function syncLogEntryKey(name, size, sourceId) {
  if (sourceId != null && String(sourceId).trim()) {
    const digest = crypto.
      createHash("sha256").
      update(String(sourceId)).
      digest("hex").
      slice(0, 32);
    return `source:${digest}`;
  }
  const n = String(name || "").trim();
  const s = size != null && size !== "" ? String(size) : "";
  return `${n}:${s}`;
}

function normalizeListLimit(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(200, Math.max(1, Math.floor(value)));
}

/**
 * In-memory sync log (tests / Redis unavailable).
 * @param {{retentionDays?: number}} [opts]
 */
function createMemorySyncLog(opts) {
  const retentionDays = normalizeRetentionDays(
    opts && opts.retentionDays,
    DEFAULT_RETENTION_DAYS,
  );
  /** @type {Map<string, Map<string, number>>} */
  const byScope = new Map();

  function mapFor(scope) {
    let m = byScope.get(scope);
    if (!m) {
      m = new Map();
      byScope.set(scope, m);
    }
    return m;
  }

  return {
    kind: "memory",
    retentionDays,
    async has(scope, entryKey) {
      const m = byScope.get(scope);
      if (!m || !m.has(entryKey)) {
        return false;
      }
      const ts = m.get(entryKey);
      const cutoff = Date.now() - retentionDays * 86400000;
      if (ts < cutoff) {
        m.delete(entryKey);
        return false;
      }
      return true;
    },
    async mark(scope, entryKey, now) {
      const t = Number(now) || Date.now();
      mapFor(scope).set(entryKey, t);
    },
    async prune(scope, now) {
      const m = byScope.get(scope);
      if (!m) {
        return 0;
      }
      const cutoff = (Number(now) || Date.now()) - retentionDays * 86400000;
      let n = 0;
      for (const [k, ts] of m) {
        if (ts < cutoff) {
          m.delete(k);
          n++;
        }
      }
      return n;
    },
    async list(scope, opts) {
      await this.prune(scope, Date.now());
      const m = byScope.get(scope);
      if (!m) {
        return [];
      }
      const limit = normalizeListLimit(opts && opts.limit);
      return Array.from(m.entries()).
        sort((a, b) => b[1] - a[1]).
        slice(0, limit).
        map(([entryKey, syncedAt]) => ({ entryKey, syncedAt }));
    },
    async count(scope) {
      await this.prune(scope, Date.now());
      return (byScope.get(scope) || new Map()).size;
    },
    async clear(scope) {
      const count = (byScope.get(scope) || new Map()).size;
      byScope.delete(scope);
      return count;
    },
    /** @private test */
    _byScope: byScope,
  };
}

/**
 * Redis-backed sync log (ZSET score=ms, member=entryKey).
 * @param {{
 *   zadd: Function,
 *   zscore: Function,
 *   zremrangebyscore: Function,
 *   zrevrange: Function,
 *   zcard: Function,
 *   del: Function,
 * }} redis
 * @param {{retentionDays?: number}} [opts]
 */
function createRedisSyncLog(redis, opts) {
  const retentionDays = normalizeRetentionDays(
    opts && opts.retentionDays,
    DEFAULT_RETENTION_DAYS,
  );

  return {
    kind: "redis",
    retentionDays,
    async has(scope, entryKey) {
      if (!scope || !entryKey) {
        return false;
      }
      try {
        const raw = await redis.zscore(scope, entryKey);
        if (raw == null || raw === false) {
          return false;
        }
        const ts = Number(raw);
        if (!Number.isFinite(ts)) {
          return false;
        }
        const cutoff = Date.now() - retentionDays * 86400000;
        if (ts < cutoff) {
          // Lazy drop of expired member
          await redis.
            zremrangebyscore(scope, "-inf", String(cutoff)).
            catch(() => {});
          return false;
        }
        return true;
      }
      catch (ex) {
        console.error("[sync-log] has", ex.message || ex);
        return false;
      }
    },
    async mark(scope, entryKey, now) {
      if (!scope || !entryKey) {
        return;
      }
      const t = Number(now) || Date.now();
      try {
        await redis.zadd(scope, String(t), entryKey);
      }
      catch (ex) {
        console.error("[sync-log] mark", ex.message || ex);
      }
    },
    async prune(scope, now) {
      if (!scope) {
        return 0;
      }
      const cutoff = (Number(now) || Date.now()) - retentionDays * 86400000;
      try {
        const n = await redis.zremrangebyscore(scope, "-inf", String(cutoff));
        return Number(n) || 0;
      }
      catch (ex) {
        console.error("[sync-log] prune", ex.message || ex);
        return 0;
      }
    },
    async list(scope, opts) {
      if (!scope) {
        return [];
      }
      await this.prune(scope, Date.now());
      const limit = normalizeListLimit(opts && opts.limit);
      try {
        const raw = await redis.zrevrange(
          scope,
          0,
          limit - 1,
          "WITHSCORES",
        );
        const output = [];
        for (let index = 0; index < raw.length; index += 2) {
          output.push({
            entryKey: String(raw[index]),
            syncedAt: Number(raw[index + 1]) || 0,
          });
        }
        return output;
      }
      catch (ex) {
        console.error("[sync-log] list", ex.message || ex);
        return [];
      }
    },
    async count(scope) {
      if (!scope) {
        return 0;
      }
      await this.prune(scope, Date.now());
      try {
        return Number(await redis.zcard(scope)) || 0;
      }
      catch (ex) {
        console.error("[sync-log] count", ex.message || ex);
        return 0;
      }
    },
    async clear(scope) {
      if (!scope) {
        return 0;
      }
      try {
        const count = Number(await redis.zcard(scope)) || 0;
        await redis.del(scope);
        return count;
      }
      catch (ex) {
        console.error("[sync-log] clear", ex.message || ex);
        return 0;
      }
    },
  };
}

/**
 * Resolve the process sync log: injected > Redis > memory.
 * @param {{
 *   syncLog?: object,
 *   retentionDays?: number,
 * }} [ctx]
 */
function resolveSyncLog(ctx) {
  if (ctx && ctx.syncLog && typeof ctx.syncLog.has === "function") {
    return ctx.syncLog;
  }
  let retentionDays = DEFAULT_RETENTION_DAYS;
  try {
    const CONFIG = require("../config");

    retentionDays = normalizeRetentionDays(
      CONFIG.get("pluginSyncLogRetentionDays"),
      DEFAULT_RETENTION_DAYS,
    );
  }
  catch (_) {
    /* optional in pure tests */
  }
  if (ctx && ctx.retentionDays != null) {
    retentionDays = normalizeRetentionDays(ctx.retentionDays, retentionDays);
  }
  // Jest / unit tests: never open a live Redis client (broker connect hangs).
  if (
    process.env.JEST_WORKER_ID != null ||
    process.env.NODE_ENV === "test" ||
    (ctx && ctx.forceMemorySyncLog)
  ) {
    return createMemorySyncLog({ retentionDays });
  }
  try {
    const BROKER = require("../broker");

    const redis = BROKER.getMethods(
      "zadd",
      "zscore",
      "zremrangebyscore",
      "zrevrange",
      "zcard",
      "del",
    );
    return createRedisSyncLog(redis, { retentionDays });
  }
  catch (ex) {
    console.warn(
      "[sync-log] Redis unavailable, using memory log:",
      ex.message || ex,
    );
    return createMemorySyncLog({ retentionDays });
  }
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  normalizeRetentionDays,
  normalizeListLimit,
  syncLogScope,
  syncLogEntryKey,
  createMemorySyncLog,
  createRedisSyncLog,
  resolveSyncLog,
};
