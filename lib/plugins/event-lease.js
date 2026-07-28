"use strict";

const crypto = require("crypto");

const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_RETENTION_DAYS = 30;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function keyHash(scope, eventId) {
  return crypto.
    createHash("sha256").
    update(`${scope || "plugin"}|${eventId || ""}`).
    digest("hex");
}

function leaseKeys(scope, eventId) {
  const hash = keyHash(scope, eventId);
  return {
    done: `plugin:event:done:${hash}`,
    lock: `plugin:event:lock:${hash}`,
  };
}

function createMemoryEventLease(opts) {
  const retentionDays = clampInt(
    opts && opts.retentionDays,
    DEFAULT_RETENTION_DAYS,
    1,
    730,
  );
  const completed = new Map();
  const locked = new Map();

  function prune(now) {
    const current = Number(now) || Date.now();
    for (const [key, expiresAt] of completed) {
      if (expiresAt <= current) {
        completed.delete(key);
      }
    }
    for (const [key, entry] of locked) {
      if (entry.expiresAt <= current) {
        locked.delete(key);
      }
    }
  }

  return {
    kind: "memory",
    begin(scope, eventId, options) {
      const now = Date.now();
      prune(now);
      const key = keyHash(scope, eventId);
      if (completed.has(key) || locked.has(key)) {
        return null;
      }
      const token = crypto.randomBytes(12).toString("hex");
      const leaseSeconds = clampInt(
        options && options.leaseSeconds,
        DEFAULT_LEASE_SECONDS,
        10,
        900,
      );
      locked.set(key, {
        token,
        expiresAt: now + leaseSeconds * 1000,
      });
      return { key, token, scope, eventId };
    },
    complete(lease) {
      if (!lease) {
        return;
      }
      const current = locked.get(lease.key);
      if (!current || current.token !== lease.token) {
        return;
      }
      locked.delete(lease.key);
      completed.set(
        lease.key,
        Date.now() + retentionDays * 24 * 60 * 60 * 1000,
      );
    },
    fail(lease) {
      if (!lease) {
        return;
      }
      const current = locked.get(lease.key);
      if (current && current.token === lease.token) {
        locked.delete(lease.key);
      }
    },
    _completed: completed,
    _locked: locked,
  };
}

function createRedisEventLease(redis, opts) {
  if (
    !redis ||
    typeof redis.get !== "function" ||
    typeof redis.set !== "function" ||
    typeof redis.del !== "function"
  ) {
    throw new Error("event lease requires Redis get/set/del methods");
  }
  const retentionDays = clampInt(
    opts && opts.retentionDays,
    DEFAULT_RETENTION_DAYS,
    1,
    730,
  );
  const doneSeconds = retentionDays * 24 * 60 * 60;

  async function release(lease) {
    if (!lease) {
      return;
    }
    const current = await redis.get(lease.lockKey);
    if (current === lease.token) {
      await redis.del(lease.lockKey);
    }
  }

  return {
    kind: "redis",
    async begin(scope, eventId, options) {
      if (!eventId) {
        throw new Error("event lease requires an event id");
      }
      const keys = leaseKeys(scope, eventId);
      if (await redis.get(keys.done)) {
        return null;
      }
      const token = crypto.randomBytes(12).toString("hex");
      const leaseSeconds = clampInt(
        options && options.leaseSeconds,
        DEFAULT_LEASE_SECONDS,
        10,
        900,
      );
      const claimed = await redis.set(
        keys.lock,
        token,
        "NX",
        "EX",
        leaseSeconds,
      );
      if (claimed !== "OK") {
        return null;
      }
      const lease = {
        scope,
        eventId,
        token,
        lockKey: keys.lock,
        doneKey: keys.done,
      };
      if (await redis.get(keys.done)) {
        await release(lease);
        return null;
      }
      return lease;
    },
    async complete(lease) {
      if (!lease) {
        return;
      }
      await redis.set(lease.doneKey, "1", "EX", doneSeconds);
      await release(lease);
    },
    async fail(lease) {
      await release(lease);
    },
  };
}

function createDefaultEventLease(opts) {
  const o = opts || {};
  if (
    o.forceMemory ||
    process.env.NODE_ENV === "test" ||
    process.env.JEST_WORKER_ID != null
  ) {
    return createMemoryEventLease(o);
  }
  const BROKER = require("../broker");

  const redis = BROKER.getMethods("get", "set", "del");
  return createRedisEventLease(redis, o);
}

module.exports = {
  DEFAULT_LEASE_SECONDS,
  DEFAULT_RETENTION_DAYS,
  keyHash,
  leaseKeys,
  createMemoryEventLease,
  createRedisEventLease,
  createDefaultEventLease,
};
