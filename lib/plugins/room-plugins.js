"use strict";

/**
 * Per-room plugin (bot) invitations — pure helpers.
 *
 * Stored on room config as `roomPlugins`:
 *   [{ id, enabled, config, invitedAt?, label? }]
 *
 * Server catalog (installed modules) is separate; this list is "which bots
 * this room invited" + their settings. roomId is always the host room.
 */

const MAX_ROOM_PLUGINS = 20;
const MAX_CONFIG_JSON = 8000;

/**
 * @param {unknown} raw
 * @returns {Array<{id: string, enabled: boolean, config: object, invitedAt: number, label: string}>}
 */
function normalizeRoomPlugins(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = String(item.id || "")
      .trim()
      .toLowerCase();
    if (!id || id.length > 64 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    let config =
      item.config && typeof item.config === "object" && !Array.isArray(item.config)
        ? Object.assign({}, item.config)
        : {};
    try {
      const s = JSON.stringify(config);
      if (s.length > MAX_CONFIG_JSON) {
        config = {};
      }
    } catch (_) {
      config = {};
    }
    // Never trust client-supplied roomId hijacks — caller forces roomId
    if (Object.prototype.hasOwnProperty.call(config, "roomId")) {
      delete config.roomId;
    }
    // Normalize the former built-in display name while preserving custom names.
    if (id === "mega-folder" && config.botName === "Mega Autoshare") {
      config.botName = "Mega.nz Autoshare";
    }
    out.push({
      id,
      enabled: item.enabled !== false,
      config,
      invitedAt: Number(item.invitedAt) || 0,
      label:
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim().slice(0, 80)
          : "",
    });
    if (out.length >= MAX_ROOM_PLUGINS) {
      break;
    }
  }
  return out;
}

/**
 * @param {object[]} list
 * @param {string} pluginId
 * @returns {object|null}
 */
function findRoomPlugin(list, pluginId) {
  const id = String(pluginId || "")
    .trim()
    .toLowerCase();
  if (!id) {
    return null;
  }
  return (list || []).find((e) => e.id === id) || null;
}

/**
 * Invite or replace a plugin entry.
 * @param {object[]} list
 * @param {{id: string, enabled?: boolean, config?: object, label?: string}} entry
 * @param {number} [now]
 */
function upsertRoomPlugin(list, entry, now) {
  const id = String((entry && entry.id) || "")
    .trim()
    .toLowerCase();
  if (!id) {
    throw new Error("plugin id required");
  }
  const base = normalizeRoomPlugins(list).filter((e) => e.id !== id);
  if (base.length >= MAX_ROOM_PLUGINS) {
    throw new Error(`at most ${MAX_ROOM_PLUGINS} room plugins`);
  }
  const prev = findRoomPlugin(list, id);
  const next = {
    id,
    enabled: entry.enabled !== false,
    config:
      entry.config && typeof entry.config === "object" && !Array.isArray(entry.config)
        ? Object.assign({}, entry.config)
        : (prev && prev.config) || {},
    invitedAt: (prev && prev.invitedAt) || Number(now) || Date.now(),
    label:
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim().slice(0, 80)
        : (prev && prev.label) || "",
  };
  if (Object.prototype.hasOwnProperty.call(next.config, "roomId")) {
    delete next.config.roomId;
  }
  base.push(next);
  return normalizeRoomPlugins(base);
}

/**
 * @param {object[]} list
 * @param {string} pluginId
 */
function removeRoomPlugin(list, pluginId) {
  const id = String(pluginId || "")
    .trim()
    .toLowerCase();
  return normalizeRoomPlugins(list).filter((e) => e.id !== id);
}

/**
 * Serialize for client UI (no secrets stripped here — operator-only RPC).
 * @param {object[]} list
 * @param {{catalog?: object[]}} [opts]
 */
function serializeRoomPlugins(list, opts) {
  const catalog = (opts && opts.catalog) || [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return normalizeRoomPlugins(list).map((e) => {
    const cat = byId.get(e.id);
    return {
      id: e.id,
      enabled: e.enabled,
      config: e.config,
      invitedAt: e.invitedAt,
      label: e.label,
      name: (cat && cat.name) || e.id,
      botName: (cat && cat.botName) || (cat && cat.name) || e.id,
      description: (cat && cat.description) || "",
      available: cat ? cat.available !== false : false,
      configSchema: (cat && cat.configSchema) || null,
      capabilities: (cat && cat.capabilities) || [],
      eventSubscriptions: (cat && cat.eventSubscriptions) || [],
    };
  });
}

module.exports = {
  MAX_ROOM_PLUGINS,
  normalizeRoomPlugins,
  findRoomPlugin,
  upsertRoomPlugin,
  removeRoomPlugin,
  serializeRoomPlugins,
};
