"use strict";

/**
 * Per-room plugin (bot) runtime — poll timers + run-with-room-config.
 *
 * Installed modules live under lib/plugins/<id>. Rooms invite them via
 * config.roomPlugins; this module starts/stops monitors when invitations change.
 */

const {
  BUILTIN_IDS,
  loadPluginModule,
  validatePluginShape,
} = require("./registry");
const { normalizeRoomPlugins, findRoomPlugin } = require("./room-plugins");

/**
 * @param {{
 *   buildCtx?: () => object,
 *   loadModule?: typeof loadPluginModule,
 *   log?: { info: Function, warn: Function, error: Function },
 * }} [deps]
 */
function createRoomPluginRuntime(deps) {
  const d = deps || {};
  const load = d.loadModule || loadPluginModule;
  const log = d.log || {
    info: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
  };

  /** @type {Map<string, NodeJS.Timeout>} key = roomId::pluginId */
  const timers = new Map();
  /** @type {object|null} shared adapter ctx from buildPluginRuntimeCtx */
  let sharedCtx = null;

  function timerKey(roomId, pluginId) {
    return `${roomId}::${pluginId}`;
  }

  function clearTimer(roomId, pluginId) {
    const k = timerKey(roomId, pluginId);
    const t = timers.get(k);
    if (t) {
      clearInterval(t);
      timers.delete(k);
    }
  }

  function clearRoom(roomId) {
    const prefix = `${roomId}::`;
    for (const k of Array.from(timers.keys())) {
      if (k.startsWith(prefix)) {
        clearInterval(timers.get(k));
        timers.delete(k);
      }
    }
  }

  function setSharedCtx(ctx) {
    sharedCtx = ctx || null;
  }

  /**
   * Catalog of installable bots for Room Options → Plugins.
   * @returns {object[]}
   */
  function listCatalog() {
    const ids = new Set(BUILTIN_IDS);
    // Also surface anything already required via process CONFIG (future)
    const out = [];
    for (const id of ids) {
      const res = load(id);
      if (!res.ok) {
        out.push({
          id,
          name: id,
          botName: id,
          description: res.error || "unavailable",
          version: "",
          available: false,
          configSchema: null,
          capabilities: [],
          eventSubscriptions: [],
        });
        continue;
      }
      const p = res.plugin;
      const shape = validatePluginShape(p);
      out.push({
        id: p.id,
        name: p.name || p.id,
        botName: p.botName || p.name || p.id,
        description: p.description || "",
        version: p.version || "0.0.0",
        available: shape.ok,
        configSchema: p.configSchema || null,
        capabilities: Array.isArray(p.capabilities)
          ? p.capabilities.slice()
          : [],
        eventSubscriptions: Array.isArray(p.eventSubscriptions)
          ? p.eventSubscriptions.slice()
          : [],
      });
    }
    return out;
  }

  /**
   * Build run ctx for a room plugin instance.
   */
  function makeRunCtx(plugin, roomId, config) {
    const base = typeof d.buildCtx === "function" ? d.buildCtx() : sharedCtx || {};
    const botName =
      (config && config.botName) ||
      plugin.botName ||
      plugin.name ||
      plugin.id;
    const mergedConfig = Object.assign({}, config || {}, { roomId });
    let uploadFile = base.uploadFile;
    if (typeof uploadFile === "function") {
      const baseUpload = uploadFile;
      uploadFile = (spec) =>
        baseUpload(
          Object.assign({}, spec || {}, {
            botName: (spec && spec.botName) || botName,
            role: (spec && spec.role) || "bot",
            meta: Object.assign(
              { plugin: plugin.id, bot: true, botName },
              (spec && spec.meta) || {},
            ),
          }),
        );
    }
    let dicefiles = base.dicefiles;
    if (
      dicefiles &&
      typeof dicefiles === "object" &&
      typeof dicefiles.postMessage === "function"
    ) {
      const basePostMessage = dicefiles.postMessage.bind(dicefiles);
      dicefiles = Object.assign({}, dicefiles, {
        postMessage(spec) {
          return basePostMessage(
            Object.assign({}, spec || {}, {
              roomId: spec && spec.roomId || roomId,
              botName: spec && spec.botName || botName,
              pluginId: spec && spec.pluginId || plugin.id,
            }),
          );
        },
      });
    }
    return Object.assign({}, base, {
      pluginId: plugin.id,
      pluginName: plugin.name,
      botName,
      config: mergedConfig,
      enabled: true,
      uploadFile,
      dicefiles,
      scheduleRun(id, args) {
        // Re-run this room instance (ignore foreign plugin ids)
        if (id && id !== plugin.id) {
          return;
        }
        setImmediate(() => {
          runRoomPlugin(roomId, plugin.id, args).catch((ex) => {
            log.error(`[room-plugins] scheduleRun ${roomId}/${plugin.id}`, ex);
          });
        });
      },
    });
  }

  /**
   * Run an invited room plugin once.
   * @param {string} roomId
   * @param {string} pluginId
   * @param {object} [args]
   * @param {object[]} [roomPluginList] — optional list (else caller must pass config via args)
   */
  async function runRoomPlugin(roomId, pluginId, args, roomPluginList) {
    const list = normalizeRoomPlugins(roomPluginList);
    const entry = findRoomPlugin(list, pluginId);
    if (!entry && !(args && args.config)) {
      throw new Error(`plugin not invited in this room: ${pluginId}`);
    }
    if (entry && !entry.enabled && !(args && args.force)) {
      throw new Error(`plugin disabled in this room: ${pluginId}`);
    }
    const res = load(pluginId);
    if (!res.ok) {
      throw new Error(res.error || `cannot load plugin ${pluginId}`);
    }
    const plugin = res.plugin;
    if (typeof plugin.run !== "function") {
      throw new Error(`plugin has no run(): ${pluginId}`);
    }
    const config = Object.assign(
      {},
      (entry && entry.config) || {},
      (args && args.config) || {},
      { roomId },
    );
    if (typeof plugin.validateConfig === "function") {
      const v = plugin.validateConfig(config);
      if (v && v.ok === false) {
        throw new Error(
          `plugin config invalid: ${(v.errors || []).join("; ")}`,
        );
      }
    }
    const ctx = makeRunCtx(plugin, roomId, config);
    return plugin.run(ctx, args || {});
  }

  /**
   * Start/stop poll timers for a room’s invited plugins.
   * @param {string} roomId
   * @param {unknown} roomPluginsRaw
   */
  function syncRoom(roomId, roomPluginsRaw) {
    if (!roomId) {
      return;
    }
    const list = normalizeRoomPlugins(roomPluginsRaw);
    const keep = new Set();

    for (const entry of list) {
      clearTimer(roomId, entry.id);
      if (!entry.enabled) {
        continue;
      }
      const mins = Number(entry.config && entry.config.pollIntervalMinutes) || 0;
      if (mins <= 0) {
        continue;
      }
      const res = load(entry.id);
      if (!res.ok || typeof res.plugin.run !== "function") {
        log.warn(
          `[room-plugins] skip poll ${roomId}/${entry.id}: ${res.error || "no run"}`,
        );
        continue;
      }
      // Startup scan once
      setImmediate(() => {
        runRoomPlugin(roomId, entry.id, { reason: "startup" }, list).catch(
          (ex) => {
            log.error(`[room-plugins] startup ${roomId}/${entry.id}`, ex);
          },
        );
      });
      const ms = Math.max(1, mins) * 60 * 1000;
      const t = setInterval(() => {
        runRoomPlugin(roomId, entry.id, { reason: "poll" }, list).catch(
          (ex) => {
            log.error(`[room-plugins] poll ${roomId}/${entry.id}`, ex);
          },
        );
      }, ms);
      if (typeof t.unref === "function") {
        t.unref();
      }
      const k = timerKey(roomId, entry.id);
      timers.set(k, t);
      keep.add(k);
      log.info(
        `[room-plugins] monitoring ${entry.id} for room ${roomId} every ${mins} min`,
      );
    }

    // Clear timers for plugins no longer invited
    const prefix = `${roomId}::`;
    for (const k of Array.from(timers.keys())) {
      if (k.startsWith(prefix) && !keep.has(k)) {
        clearInterval(timers.get(k));
        timers.delete(k);
      }
    }
  }

  /**
   * Event fan-out for room plugins that list pollEvents.
   * Requires a way to resolve which rooms have plugins — pass a getter.
   * @param {string} event
   * @param {object} payload
   * @param {(roomId: string) => unknown} getRoomPlugins
   * @param {string[]} roomIds
   */
  async function emitEventToRooms(event, payload, getRoomPlugins, roomIds) {
    if (!Array.isArray(roomIds)) {
      return;
    }
    for (const roomId of roomIds) {
      const list = normalizeRoomPlugins(
        typeof getRoomPlugins === "function"
          ? await getRoomPlugins(roomId)
          : null,
      );
      await emitEventToRoom(event, payload, roomId, list);
    }
  }

  /**
   * Deliver a lifecycle event to the invited plugins for one room.
   * Plugins opt in declaratively through `eventSubscriptions`; legacy plugins
   * may continue to use config.pollEvents with run().
   */
  async function emitEventToRoom(event, payload, roomId, roomPluginsRaw) {
    const list = normalizeRoomPlugins(roomPluginsRaw);
    const pending = [];
    for (const entry of list) {
      if (!entry.enabled) {
        continue;
      }
      const res = load(entry.id);
      if (!res.ok) {
        log.warn(
          `[room-plugins] event skip ${roomId}/${entry.id}: ${res.error}`,
        );
        continue;
      }
      const plugin = res.plugin;
      const subscriptions = Array.isArray(plugin.eventSubscriptions)
        ? plugin.eventSubscriptions
        : [];
      const legacyEvents =
        entry.config && Array.isArray(entry.config.pollEvents)
          ? entry.config.pollEvents
          : [];
      if (
        !subscriptions.includes(event) &&
        !legacyEvents.includes(event)
      ) {
        continue;
      }
      const ctx = makeRunCtx(plugin, roomId, entry.config);
      if (plugin.hooks && typeof plugin.hooks.onEvent === "function") {
        pending.push(
          Promise.resolve(plugin.hooks.onEvent(event, payload, ctx)).catch(
            (ex) => {
              log.error(
                `[room-plugins] onEvent ${event} ${roomId}/${entry.id}`,
                ex,
              );
            },
          ),
        );
      } else if (typeof plugin.run === "function") {
        pending.push(
          Promise.resolve(
            plugin.run(ctx, { reason: event, event, payload }),
          ).catch((ex) => {
            log.error(
              `[room-plugins] run event ${event} ${roomId}/${entry.id}`,
              ex,
            );
          }),
        );
      }
    }
    await Promise.all(pending);
  }

  return {
    listCatalog,
    runRoomPlugin,
    syncRoom,
    clearRoom,
    setSharedCtx,
    emitEventToRoom,
    emitEventToRooms,
    _timers: timers,
  };
}

/** Process singleton — wired from httpserver */
const defaultRoomPluginRuntime = createRoomPluginRuntime();

module.exports = {
  createRoomPluginRuntime,
  defaultRoomPluginRuntime,
};
