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
const { safeErrorMessage } = require("./metadata");
const { normalizePluginId } = require("./plugin-id");
const {
  completedRunStatus,
  defaultPluginRunStatus,
} = require("./run-status");

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
  const invitations = new Map();
  const activeRuns = new Set();
  const timerConfigs = new Map();
  /** @type {object|null} shared adapter ctx from buildPluginRuntimeCtx */
  let sharedCtx = null;
  const now = typeof d.now === "function" ? d.now : Date.now;
  const runStatus =
    d.runStatus ||
    defaultPluginRunStatus;

  function timerKey(roomId, pluginId) {
    return `${roomId}::${pluginId}`;
  }

  function clearTimer(roomId, pluginId) {
    const k = timerKey(roomId, pluginId);
    const t = timers.get(k);
    if (t) {
      clearInterval(t);
      timers.delete(k);
      timerConfigs.delete(k);
    }
  }

  function clearRoom(roomId) {
    invitations.delete(roomId);
    const prefix = `${roomId}::`;
    for (const k of Array.from(timers.keys())) {
      if (k.startsWith(prefix)) {
        clearInterval(timers.get(k));
        timers.delete(k);
        timerConfigs.delete(k);
      }
    }
  }

  function setSharedCtx(ctx) {
    sharedCtx = ctx || null;
  }

  function scheduledRunEventId(reason, args, config) {
    if (!reason || reason === "manual" || reason === "job" || reason === "review") {
      return "";
    }
    const payload = args && args.payload;
    const stablePayloadId =
      payload && (payload.eventId || payload.key || payload.id);
    if (stablePayloadId) {
      return `${reason}:${stablePayloadId}`;
    }
    const intervalMinutes =
      reason === "poll" ?
        Math.max(1, Number(config.pollIntervalMinutes) || 1) :
        5;
    const bucketMs = intervalMinutes * 60 * 1000;
    return `${reason}:${Math.floor(now() / bucketMs)}`;
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
        capabilities: Array.isArray(p.capabilities) ?
          p.capabilities.slice() :
          [],
        eventSubscriptions: Array.isArray(p.eventSubscriptions) ?
          p.eventSubscriptions.slice() :
          [],
        runModes: Array.isArray(p.runModes) ? p.runModes.slice() : [],
        category: p.category || "Imports & publishing",
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
    let {uploadFile} = base;
    if (typeof uploadFile === "function") {
      const baseUpload = uploadFile;
      uploadFile = spec =>
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
    let {dicefiles} = base;
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
    dicefiles = require("./scoped-api").scopedPluginApi(dicefiles, { roomId, pluginId: plugin.id, botName });
    uploadFile = require("./scoped-api").scopedUpload(uploadFile, roomId, { pluginId: plugin.id, botName });
    const state = base.createPluginState?.({ roomId, pluginId: plugin.id });
    return Object.assign({}, base, {
      pluginId: plugin.id,
      pluginName: plugin.name,
      botName,
      config: mergedConfig,
      enabled: true,
      uploadFile,
      dicefiles,
      apiVersion: 2,
      state,
      report: state ? require("./reports").createPluginReport(state, mergedConfig) : undefined,
      createPluginState: undefined,
      connections: base.createPluginConnections?.({ roomId, pluginId: plugin.id }),
      createPluginConnections: undefined,
      jobs: base.createPluginJobs?.({ roomId, pluginId: plugin.id, config: mergedConfig }),
      createPluginJobs: undefined,
      scheduleRun(id, args) {
        // Re-run this room instance (ignore foreign plugin ids)
        if (id && id !== plugin.id) {
          return;
        }
        if (base.createPluginJobs) {
          const current = findRoomPlugin(invitations.get(roomId) || [], plugin.id);
          if (!current?.enabled) {
            return;
          }
          return base.createPluginJobs({ roomId, pluginId: plugin.id, config: { ...current.config, roomId } }).enqueue({
            idempotencyKey: scheduledRunEventId(args?.reason, args, current.config) || undefined,
          });
        }
        setImmediate(() => {
          runRoomPlugin(roomId, plugin.id, args, invitations.get(roomId) || []).catch(ex => {
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
   * @param {object[]} [roomPluginList] — latest saved invitations
   */
  async function runRoomPlugin(roomId, pluginId, args, roomPluginList) {
    pluginId = normalizePluginId(pluginId);
    if (!pluginId) {
      throw new Error("Choose a valid installed bot before running it.");
    }
    const list = normalizeRoomPlugins(roomPluginList);
    if (Array.isArray(roomPluginList)) {
      invitations.set(roomId, list);
    }
    const entry = findRoomPlugin(list, pluginId);
    if (!entry) {
      throw new Error(`plugin not invited in this room: ${pluginId}`);
    }
    if (!entry.enabled) {
      throw new Error(`plugin disabled in this room: ${pluginId}`);
    }
    const res = load(pluginId);
    if (!res.ok) {
      throw new Error(res.error || `cannot load plugin ${pluginId}`);
    }
    const {plugin} = res;
    if (typeof plugin.run !== "function") {
      throw new Error(`plugin has no run(): ${pluginId}`);
    }
    const config = Object.assign(
      {},
      (entry && entry.config) || {},
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
    const runArgs = Object.assign({}, args || {});
    delete runArgs.config; delete runArgs.force;
    ctx.executingJob = !!runArgs.job;
    if (runArgs.signal instanceof AbortSignal) {
      ctx.signal = runArgs.signal;
    }
    if (runArgs.mode && !(plugin.runModes || []).includes(runArgs.mode)) {
      throw Object.assign(new Error(`This bot does not support that run mode. Available modes: ${(plugin.runModes || []).join(", ") || "default"}.`), { status: 400 });
    }
    const eventId = scheduledRunEventId(runArgs.reason, runArgs, config);
    const events = ctx && ctx.events;
    let lease = null;
    if (eventId && events && typeof events.begin === "function") {
      lease = await events.begin(
        `room-plugin-run:${roomId}:${pluginId}`,
        eventId,
        { leaseSeconds: 900 },
      );
      if (!lease) {
        return {
          skipped: true,
          reason: "already_running_or_completed",
        };
      }
    }
    const startedAt = now();
    const activeKey = timerKey(roomId, pluginId);
    let activeLease = null;
    let guard;
    if (activeRuns.has(activeKey)) {
      if (lease) {
        await events.fail(lease);
      }
      return { skipped: true, reason: "already_running" };
    }
    activeRuns.add(activeKey);
    try {
      if (events && typeof events.begin === "function") {
        activeLease = await events.begin(`plugin-active:${activeKey}`, "active", { leaseSeconds: 900 });
        if (!activeLease) {
          if (lease) {
            await events.fail(lease);
          }
          return { skipped: true, reason: "already_running" };
        }
      }
      guard = require("./run-guard").guardPluginRun(ctx, [activeLease, lease]);
      const result = await plugin.run(ctx, runArgs);
      await guard.assertOwned();
      if (result?.report && ctx.report) {
        await ctx.report.write(result.report);
      }
      if (lease && typeof events.complete === "function") {
        await events.complete(lease);
      }
      await runStatus.record(
        completedRunStatus({
          roomId,
          pluginId,
          reason: runArgs.reason,
          startedAt,
          finishedAt: now(),
          ok: true,
          result,
        }),
      ).catch(() => {});
      return result;
    }
    catch (failure) {
      const error = failure instanceof Error ? failure : new Error(safeErrorMessage(failure, config));
      error.message = safeErrorMessage(error, config);
      if (lease && typeof events.fail === "function") {
        await Promise.resolve(events.fail(lease)).catch(() => {});
      }
      await runStatus.record(
        completedRunStatus({
          roomId,
          pluginId,
          reason: runArgs.reason,
          startedAt,
          finishedAt: now(),
          ok: false,
          error: error && error.message,
        }),
      ).catch(() => {});
      throw error;
    }
    finally {
      guard?.stop();
      activeRuns.delete(activeKey);
      if (activeLease) {
        await Promise.resolve(events.fail(activeLease)).catch(() => {});
      }
    }
  }

  async function handleRoomPluginInbound(
      roomId,
      pluginId,
      request,
      roomPluginList,
  ) {
    pluginId = normalizePluginId(pluginId);
    const list = normalizeRoomPlugins(roomPluginList);
    const entry = findRoomPlugin(list, pluginId);
    if (!entry) {
      throw new Error(`plugin not invited in this room: ${pluginId}`);
    }
    if (!entry.enabled) {
      throw new Error(`plugin disabled in this room: ${pluginId}`);
    }
    const res = load(pluginId);
    if (!res.ok) {
      throw new Error(res.error || `cannot load plugin ${pluginId}`);
    }
    const {plugin} = res;
    if (
      !plugin.inbound ||
      typeof plugin.inbound.handle !== "function"
    ) {
      throw new Error(`plugin has no inbound endpoint: ${pluginId}`);
    }
    const config = Object.assign({}, entry.config || {}, { roomId });
    if (typeof plugin.validateConfig === "function") {
      const validation = plugin.validateConfig(config);
      if (validation && validation.ok === false) {
        throw new Error(
          `plugin config invalid: ${(validation.errors || []).join("; ")}`,
        );
      }
    }
    return plugin.inbound.handle(
      request || {},
      makeRunCtx(plugin, roomId, config),
    );
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
    invitations.set(roomId, list);
    const keep = new Set();

    for (const entry of list) {
      if (!entry.enabled) {
        clearTimer(roomId, entry.id);
        continue;
      }
      const mins = Number(entry.config && entry.config.pollIntervalMinutes) || 0;
      if (!Number.isFinite(mins) || mins <= 0 || mins > 10080) {
        clearTimer(roomId, entry.id);
        continue;
      }
      const k = timerKey(roomId, entry.id);
      const fingerprint = JSON.stringify(entry.config);
      if (timers.has(k) && timerConfigs.get(k) === fingerprint) {
        keep.add(k); continue;
      }
      clearTimer(roomId, entry.id);
      const res = load(entry.id);
      if (!res.ok || typeof res.plugin.run !== "function") {
        log.warn(
          `[room-plugins] skip poll ${roomId}/${entry.id}: ${res.error || "no run"}`,
        );
        continue;
      }
      // Startup scan once
      setImmediate(() => {
        scheduleRoomRun(roomId, entry.id, { reason: "startup" }).catch(
          ex => {
            log.error(`[room-plugins] startup ${roomId}/${entry.id}`, ex);
          },
        );
      });
      const ms = Math.max(1, mins) * 60 * 1000;
      const t = setInterval(() => {
        scheduleRoomRun(roomId, entry.id, { reason: "poll" }).catch(
          ex => {
            log.error(`[room-plugins] poll ${roomId}/${entry.id}`, ex);
          },
        );
      }, ms);
      if (typeof t.unref === "function") {
        t.unref();
      }
      timers.set(k, t);
      timerConfigs.set(k, fingerprint);
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
        timerConfigs.delete(k);
      }
    }
  }

  async function scheduleRoomRun(roomId, pluginId, args) {
    const current = invitations.get(roomId) || [];
    const entry = findRoomPlugin(current, pluginId);
    if (!entry?.enabled) {
      return { skipped: true };
    }
    const base = typeof d.buildCtx === "function" ? d.buildCtx() : sharedCtx || {};
    if (base.createPluginJobs) {
      return base.createPluginJobs({ roomId, pluginId, config: { ...entry.config, roomId } }).enqueue({ idempotencyKey: scheduledRunEventId(args.reason, args, entry.config) || undefined });
    }
    return runRoomPlugin(roomId, pluginId, args, current);
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
        typeof getRoomPlugins === "function" ?
          await getRoomPlugins(roomId) :
          null,
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
    invitations.set(roomId, list);
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
      const {plugin} = res;
      const subscriptions = Array.isArray(plugin.eventSubscriptions) ?
        plugin.eventSubscriptions :
        [];
      const legacyEvents =
        entry.config && Array.isArray(entry.config.pollEvents) ?
          entry.config.pollEvents :
          [];
      if (
        !subscriptions.includes(event) &&
        !legacyEvents.includes(event)
      ) {
        continue;
      }
      const ctx = makeRunCtx(plugin, roomId, entry.config);
      if (plugin.hooks && typeof plugin.hooks.onEvent === "function") {
        const startedAt = now();
        pending.push(
          Promise.resolve().then(() => plugin.hooks.onEvent(event, payload, ctx)).then(async result => {
            await runStatus.record(completedRunStatus({ roomId, pluginId: entry.id, reason: event, startedAt, finishedAt: now(), ok: true, result })).catch(() => {});
          }).catch(
            async ex => {
              await runStatus.record(completedRunStatus({ roomId, pluginId: entry.id, reason: event, startedAt, finishedAt: now(), ok: false, error: safeErrorMessage(ex, entry.config) })).catch(() => {});
              log.error(
                `[room-plugins] onEvent ${event} ${roomId}/${entry.id}`,
                safeErrorMessage(ex, entry.config),
              );
            },
          ),
        );
      }
      else if (typeof plugin.run === "function") {
        pending.push(
          runRoomPlugin(roomId, entry.id, { reason: event, event, payload }, list).catch(ex => {
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
    handleRoomPluginInbound,
    syncRoom,
    clearRoom,
    setSharedCtx,
    emitEventToRoom,
    emitEventToRooms,
    _scheduledRunEventId: scheduledRunEventId,
    _timers: timers,
  };
}

/** Process singleton — wired from httpserver */
const defaultRoomPluginRuntime = createRoomPluginRuntime();

module.exports = {
  createRoomPluginRuntime,
  defaultRoomPluginRuntime,
};
