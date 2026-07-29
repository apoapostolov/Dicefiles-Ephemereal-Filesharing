"use strict";

const crypto = require("crypto");

const RETENTION_SECONDS = 30 * 24 * 60 * 60;

function statusKey(roomId, pluginId) {
  const digest = crypto.
    createHash("sha256").
    update(`${roomId || ""}\0${pluginId || ""}`).
    digest("hex");
  return `plugin:run-status:${digest}`;
}

function boundedMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") {
    return {};
  }
  const summary = {};
  for (const field of [
    "uploaded",
    "uploadedBytes",
    "skipped",
    "delivered",
  ]) {
    const value = boundedMetric(result[field]);
    if (value != null) {
      summary[field] = value;
    }
  }
  if (result.test === true) {
    summary.test = true;
  }
  return summary;
}

function createMemoryRunStatusStore() {
  const values = new Map();
  return {
    record(status) {
      values.set(statusKey(status.roomId, status.pluginId), status);
      return Promise.resolve();
    },
    get(roomId, pluginId) {
      return Promise.resolve(
        values.get(statusKey(roomId, pluginId)) || null,
      );
    },
    _values: values,
  };
}

function createRedisRunStatusStore(redis) {
  if (!redis || typeof redis.get !== "function" || typeof redis.set !== "function") {
    throw new Error("plugin run status requires Redis get/set methods");
  }
  return {
    async record(status) {
      await redis.set(
        statusKey(status.roomId, status.pluginId),
        JSON.stringify(status),
        "EX",
        RETENTION_SECONDS,
      );
    },
    async get(roomId, pluginId) {
      const raw = await redis.get(statusKey(roomId, pluginId));
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw);
      }
      catch (_) {
        return null;
      }
    },
  };
}

function createDefaultRunStatusStore() {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.JEST_WORKER_ID != null
  ) {
    return createMemoryRunStatusStore();
  }
  const BROKER = require("../broker");

  return createRedisRunStatusStore(BROKER.getMethods("get", "set"));
}

function completedRunStatus(spec) {
  return {
    roomId: String(spec.roomId || ""),
    pluginId: String(spec.pluginId || ""),
    ok: spec.ok === true,
    reason: String(spec.reason || "manual").slice(0, 80),
    startedAt: Number(spec.startedAt) || Date.now(),
    finishedAt: Number(spec.finishedAt) || Date.now(),
    durationMs: Math.max(
      0,
      (Number(spec.finishedAt) || Date.now()) -
        (Number(spec.startedAt) || Date.now()),
    ),
    result: summarizeResult(spec.result),
    error:
      spec.ok === true ?
        "" :
        String(spec.error || "Plugin run failed").slice(0, 300),
  };
}

const defaultPluginRunStatus = createDefaultRunStatusStore();

module.exports = {
  RETENTION_SECONDS,
  statusKey,
  summarizeResult,
  completedRunStatus,
  createMemoryRunStatusStore,
  createRedisRunStatusStore,
  defaultPluginRunStatus,
};
