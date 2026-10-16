"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { normalizePluginId } = require("./plugin-id");

const MAX_VALUE_BYTES = 16 * 1024;
const MAX_NAMESPACE_BYTES = 256 * 1024;
const MAX_KEYS = 256;

function stateError(code) {
  const messages = {
    CONFLICT: "Plugin state changed. Read the current value and retry with its version.",
    LIMIT: "Plugin state storage is full. Remove old checkpoints or reduce stored data.",
  };
  return Object.assign(new Error(messages[code] || "Plugin state is unavailable. Retry later."), { code: `PLUGIN_STATE_${code}`, status: code === "CONFLICT" ? 409 : 400 });
}

function memoryBackend(now) {
  const namespaces = new Map();
  return async (scope, operation, key, input) => {
    const time = now();
    const values = namespaces.get(scope) || new Map();
    for (const [name, row] of values) {
      if (row.expiresAt <= time) {
        values.delete(name);
      }
    }
    if (["set", "delete"].includes(operation)) {
      const previous = values.get(key);
      if (input.checkVersion && (previous?.version || "") !== input.expectedVersion) {
        return { error: "CONFLICT" };
      }
      if (operation === "delete") {
        const deleted = values.delete(key);
        if (!values.size) {
          namespaces.delete(scope);
        }
        return { deleted };
      }
      const row = { valueJson: input.valueJson, version: input.version, updatedAt: time, expiresAt: time + input.ttlSeconds * 1000 };
      const next = new Map(values); next.set(key, row);
      if (next.size > MAX_KEYS || Buffer.byteLength(JSON.stringify(Object.fromEntries(next))) > MAX_NAMESPACE_BYTES) {
        return { error: "LIMIT" };
      }
      namespaces.set(scope, next); return { row };
    }
    return operation === "get" ? { row: values.get(key) || null } : { entries: Object.fromEntries(values) };
  };
}

/** Private checkpoints and cursors. Never use this as an upload or secret store. */
function createPluginStateFactory(options = {}) {
  const memory = options.memory ?? (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID != null);
  const backend = options.backend || (memory ? memoryBackend(options.now || Date.now) : async (scope, operation, key, input) => {
    const redis = options.redis || require("../broker").getMethods("pluginstate");
    return JSON.parse(await redis.pluginstate(scope, operation, key, JSON.stringify(input)));
  });
  return ({ pluginId, roomId }) => {
    if (!normalizePluginId(pluginId)) {
      throw new Error("A valid plugin identity is required for state storage.");
    }
    const namespace = `plugin:state:${createHash("sha256").update(`${normalizePluginId(pluginId)}\0${roomId ? `room:${roomId}` : "global"}`).digest("hex")}`;
    const validateKey = key => {
      if (typeof key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(key)) {
        throw new Error("Plugin state keys must use 1–128 letters, digits, colons, dots, underscores or hyphens.");
      }
      return key;
    };
    const call = async (operation, key, input = {}) => {
      const result = await backend(namespace, operation, key, input);
      if (result.error) {
        throw stateError(result.error);
      }
      return result;
    };
    const versionInput = options => {
      if (options.ifVersion !== undefined && options.ifVersion !== null && (typeof options.ifVersion !== "string" || options.ifVersion.length > 64)) {
        throw new Error("Use the version returned by state.get, or null to create a new key.");
      }
      return { checkVersion: options.ifVersion !== undefined, expectedVersion: options.ifVersion || "" };
    };
    const unpack = row => row ? { value: JSON.parse(row.valueJson), version: row.version, updatedAt: row.updatedAt, expiresAt: row.expiresAt } : null;
    return Object.freeze({
      async get(key) {
        return unpack((await call("get", validateKey(key))).row);
      },
      async set(key, value, options = {}) {
        validateKey(key);
        let valueJson;
        try {
          valueJson = JSON.stringify(value);
        }
        catch (_) { /* A bounded validation error follows. */ }
        if (typeof valueJson !== "string" || Buffer.byteLength(valueJson) > MAX_VALUE_BYTES) {
          throw new Error("Plugin state values must be JSON no larger than 16 KiB. Store files through uploadFile.");
        }
        const checkDepth = (item, depth = 0) => {
          if (depth > 16) {
            throw new Error("Plugin state JSON must be no more than 16 levels deep. Flatten the checkpoint data.");
          }
          if (item && typeof item === "object") {
            Object.values(item).forEach(child => checkDepth(child, depth + 1));
          }
        };
        checkDepth(JSON.parse(valueJson));
        const ttlSeconds = options.ttlSeconds ?? 30 * 86400;
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 90 * 86400) {
          throw new Error("Plugin state retention must be 60 seconds to 90 days.");
        }
        return unpack((await call("set", key, { ...versionInput(options), valueJson, version: randomUUID(), ttlSeconds })).row);
      },
      async delete(key, options = {}) {
        return (await call("delete", validateKey(key), versionInput(options))).deleted === true;
      },
      async list(options = {}) {
        const prefix = String(options.prefix || "");
        if (prefix.length > 128 || !/^[a-zA-Z0-9:._-]*$/.test(prefix)) {
          throw new Error("Use a valid plugin state key prefix.");
        }
        let after = "";
        if (options.cursor) {
          if (typeof options.cursor !== "string" || options.cursor.length > 256) {
            throw new Error("State cursor is invalid. Restart listing from the first page.");
          }
          after = validateKey(Buffer.from(options.cursor, "base64url").toString());
        }
        const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 50)));
        const { entries } = await call("list", "");
        const keys = Object.keys(entries).filter(key => key.startsWith(prefix) && key > after).sort();
        const selected = keys.slice(0, limit);
        return { entries: selected.map(key => {
          const { version, updatedAt, expiresAt } = entries[key]; return { key, version, updatedAt, expiresAt };
        }), nextCursor: keys.length > limit ? Buffer.from(selected[selected.length - 1]).toString("base64url") : null };
      },
    });
  };
}

module.exports = { createPluginStateFactory };
