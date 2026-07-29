"use strict";

const { loadPluginModule } = require("./registry");
const { resolveSyncLog, normalizeListLimit } = require("./sync-log");
const { defaultPluginRunStatus } = require("./run-status");

function invitedPlugin(room, pluginId) {
  const id = String(pluginId || "").trim().toLowerCase();
  const entry = room.getRoomPlugins().find(plugin => plugin.id === id);
  if (!entry) {
    const error = new Error("Room plugin not found");
    error.status = 404;
    throw error;
  }
  return entry;
}

function syncContract(room, pluginId) {
  const entry = invitedPlugin(room, pluginId);
  const loaded = loadPluginModule(entry.id);
  if (!loaded.ok) {
    throw new Error(loaded.error || `Plugin unavailable: ${entry.id}`);
  }
  const contract = loaded.plugin.syncLog;
  if (!contract || typeof contract.scope !== "function") {
    return { entry, plugin: loaded.plugin, contract: null, scope: "" };
  }
  const config = Object.assign({}, entry.config, { roomId: room.roomid });
  return {
    entry,
    plugin: loaded.plugin,
    contract,
    scope: contract.scope(config),
  };
}

async function inspectPluginSyncMemory(room, pluginId, opts) {
  const resolved = syncContract(room, pluginId);
  const lastRun = await defaultPluginRunStatus.
    get(room.roomid, resolved.entry.id).
    catch(() => null);
  if (!resolved.contract) {
    return {
      pluginId: resolved.entry.id,
      supported: false,
      label: "",
      count: 0,
      latestAt: 0,
      retentionDays: 0,
      entries: [],
      lastRun,
    };
  }
  const log = resolveSyncLog(opts);
  const limit = normalizeListLimit(opts && opts.limit);
  await log.prune(resolved.scope, Date.now());
  const [entries, count] = await Promise.all([
    log.list(resolved.scope, { limit }),
    log.count(resolved.scope),
  ]);
  return {
    pluginId: resolved.entry.id,
    supported: true,
    label:
      String(resolved.contract.label || "").trim() ||
      "Remembered imported files",
    count,
    latestAt: entries.length ? Number(entries[0].syncedAt) || 0 : 0,
    retentionDays: log.retentionDays,
    entries,
    lastRun,
  };
}

async function clearPluginSyncMemory(room, pluginId, opts) {
  if (!opts || opts.confirm !== true) {
    const error = new Error(
      "Clearing remembered imports requires confirm: true",
    );
    error.status = 400;
    throw error;
  }
  const resolved = syncContract(room, pluginId);
  if (!resolved.contract) {
    const error = new Error("This plugin does not keep import memory");
    error.status = 409;
    throw error;
  }
  const log = resolveSyncLog(opts);
  const removed = await log.clear(resolved.scope);
  if (typeof resolved.contract.clearLocal === "function") {
    resolved.contract.clearLocal(
      Object.assign({}, resolved.entry.config, { roomId: room.roomid }),
    );
  }
  return {
    pluginId: resolved.entry.id,
    supported: true,
    removed,
    count: 0,
    latestAt: 0,
    retentionDays: log.retentionDays,
  };
}

module.exports = {
  invitedPlugin,
  syncContract,
  inspectPluginSyncMemory,
  clearPluginSyncMemory,
};
