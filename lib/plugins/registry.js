"use strict";

/**
 * First-party plugin registry.
 *
 * Plugins are plain modules exporting:
 *   {
 *     id: string,
 *     name: string,
 *     version?: string,
 *     description?: string,
 *     configSchema?: object,   // JSON-schema-ish description for docs
 *     hooks?: {
 *       onEvent?: (event, payload, ctx) => void|Promise,
 *       onStart?: (ctx) => void|Promise,
 *       onStop?: (ctx) => void|Promise,
 *     },
 *     validateConfig?: (config) => { ok: boolean, errors?: string[] },
 *     run?: (ctx, args) => Promise|any   // imperative entry (e.g. Mega.nz sync)
 *   }
 *
 * Load path: CONFIG.plugins = [{ id, enabled, config }]
 * plus optional require of modules under lib/plugins/<id>/index.js
 */

const path = require("path");
const fs = require("fs");
const { normalizePluginId } = require("./plugin-id");
const { safeErrorMessage } = require("./metadata");
const {
  completedRunStatus,
  defaultPluginRunStatus,
} = require("./run-status");

const BUILTIN_IDS = Object.freeze([
  "mega-folder",
  "remote-import",
  "discord-release",
  "telegram-release",
  "feed-collector",
  "s3-collection",
  "nextcloud-collection",
  "drive-collection",
  "dropbox-collection",
  "onedrive-collection",
  "huggingface-collection",
  "welcome-guide",
  "request-triage",
  "request-steward",
  "community-digest",
  "collection-curator",
  "duplicate-review",
  "upload-review",
  "session-organizer",
  "expiry-concierge",
  "preview-repair",
  "file-integrity",
  "storage-capacity",
  "backup-verification",
  "link-health",
  "access-review",
  "metadata-steward",
]);

/**
 * Normalize plugin config list from defaults / .config.json.
 * @param {unknown} raw
 * @returns {Array<{id: string, enabled: boolean, config: object}>}
 */
function normalizePluginConfigs(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = normalizePluginId(item.id || item.name);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      enabled: item.enabled !== false,
      config:
        item.config && typeof item.config === "object" && !Array.isArray(item.config) ?
          Object.assign({}, item.config) :
          {},
    });
  }
  return out;
}

/**
 * Resolve module path for a plugin id (first-party only for v1).
 * @param {string} id
 * @param {string} [pluginsRoot]
 * @returns {string|null}
 */
function resolvePluginModulePath(id, pluginsRoot) {
  id = normalizePluginId(id);
  if (!id) {
    return null;
  }
  const root =
    pluginsRoot || path.join(__dirname);
  const candidate = path.join(root, id, "index.js");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  // also allow mega-folder alias
  if (id === "mega" || id === "mega.nz") {
    const alt = path.join(root, "mega-folder", "index.js");
    if (fs.existsSync(alt)) {
      return alt;
    }
  }
  return null;
}

/**
 * Load a plugin module by id (sync require).
 * @param {string} id
 * @param {{pluginsRoot?: string, requireFn?: Function}} [opts]
 * @returns {{ok: boolean, plugin?: object, error?: string}}
 */
function loadPluginModule(id, opts) {
  const o = opts || {};
  const req = o.requireFn || require;
  const modPath = resolvePluginModulePath(id, o.pluginsRoot);
  if (!modPath) {
    return { ok: false, error: `plugin module not found: ${id}` };
  }
  try {
    const mod = req(modPath);
    const plugin = mod && (mod.default || mod);
    if (!plugin || typeof plugin !== "object" || !plugin.id) {
      return { ok: false, error: `invalid plugin export: ${id}` };
    }
    return { ok: true, plugin };
  }
  catch (ex) {
    return { ok: false, error: ex.message || String(ex) };
  }
}

/**
 * Validate plugin definition shape.
 * @param {object} plugin
 * @returns {{ok: boolean, errors: string[]}}
 */
function validatePluginShape(plugin) {
  const errors = [];
  if (!plugin || typeof plugin !== "object") {
    return { ok: false, errors: ["plugin is not an object"] };
  }
  if (!plugin.id || typeof plugin.id !== "string") {
    errors.push("plugin.id required");
  }
  if (!plugin.name || typeof plugin.name !== "string") {
    errors.push("plugin.name required");
  }
  if (plugin.hooks && typeof plugin.hooks !== "object") {
    errors.push("plugin.hooks must be object");
  }
  if (plugin.validateConfig && typeof plugin.validateConfig !== "function") {
    errors.push("plugin.validateConfig must be function");
  }
  if (plugin.run && typeof plugin.run !== "function") {
    errors.push("plugin.run must be function");
  }
  if (
    plugin.capabilities != null &&
    (!Array.isArray(plugin.capabilities) ||
      plugin.capabilities.some(value => typeof value !== "string"))
  ) {
    errors.push("plugin.capabilities must be an array of strings");
  }
  if (
    plugin.eventSubscriptions != null &&
    (!Array.isArray(plugin.eventSubscriptions) ||
      plugin.eventSubscriptions.some(value => typeof value !== "string"))
  ) {
    errors.push("plugin.eventSubscriptions must be an array of strings");
  }
  return { ok: !errors.length, errors };
}

/**
 * Registry of active plugins.
 */
class PluginRegistry {
  constructor() {
    /** @type {Map<string, {plugin: object, config: object, enabled: boolean}>} */
    this.entries = new Map();
    this.started = false;
    this.ctx = null;
  }

  /**
   * Register a plugin instance (already loaded).
   * @param {object} plugin
   * @param {object} [config]
   * @param {boolean} [enabled]
   */
  register(plugin, config, enabled) {
    const shape = validatePluginShape(plugin);
    if (!shape.ok) {
      throw new Error(`Invalid plugin: ${shape.errors.join("; ")}`);
    }
    const cfg = config && typeof config === "object" ? config : {};
    if (typeof plugin.validateConfig === "function") {
      const v = plugin.validateConfig(cfg);
      if (v && v.ok === false) {
        throw new Error(
          `Plugin ${plugin.id} config invalid: ${(v.errors || []).join("; ")}`,
        );
      }
    }
    this.entries.set(plugin.id, {
      plugin,
      config: cfg,
      enabled: enabled !== false,
    });
  }

  /**
   * Load from CONFIG-like list using require.
   * @param {unknown} rawConfigs
   * @param {{pluginsRoot?: string, requireFn?: Function, onlyEnabled?: boolean}} [opts]
   * @returns {{loaded: string[], errors: Array<{id: string, error: string}>}}
   */
  loadFromConfig(rawConfigs, opts) {
    const list = normalizePluginConfigs(rawConfigs);
    const loaded = [];
    const errors = [];
    for (const item of list) {
      if (opts?.onlyEnabled !== false && !item.enabled) {
        continue;
      }
      const res = loadPluginModule(item.id, opts);
      if (!res.ok) {
        errors.push({ id: item.id, error: res.error });
        continue;
      }
      try {
        this.register(res.plugin, item.config, item.enabled);
        loaded.push(item.id);
      }
      catch (ex) {
        errors.push({ id: item.id, error: ex.message || String(ex) });
      }
    }
    return { loaded, errors };
  }

  list() {
    return Array.from(this.entries.values()).map(e => ({
      id: e.plugin.id,
      name: e.plugin.name,
      version: e.plugin.version || "0.0.0",
      description: e.plugin.description || "",
      enabled: e.enabled,
      config: e.config,
      capabilities: Array.isArray(e.plugin.capabilities) ?
        e.plugin.capabilities.slice() :
        [],
      eventSubscriptions: Array.isArray(e.plugin.eventSubscriptions) ?
        e.plugin.eventSubscriptions.slice() :
        [],
    }));
  }

  get(id) {
    return this.entries.get(normalizePluginId(id)) || null;
  }

  /**
   * @param {object} ctx — shared runtime (log, upload, room, events, …)
   */
  async startAll(ctx) {
    this.ctx = ctx || {};
    this.started = true;
    for (const e of this.entries.values()) {
      if (!e.enabled) {
        continue;
      }
      if (e.plugin.hooks && typeof e.plugin.hooks.onStart === "function") {
        try {
          await e.plugin.hooks.onStart(this.makePluginCtx(e));
        }
        catch (error) {
          e.enabled = false;
          (this.ctx.log?.error || console.error)(`plugin ${e.plugin.id} could not start; disabled for this process`, safeErrorMessage(error, e.config));
        }
      }
    }
  }

  async stopAll() {
    for (const e of this.entries.values()) {
      if (e.plugin.hooks && typeof e.plugin.hooks.onStop === "function") {
        try {
          await e.plugin.hooks.onStop(this.makePluginCtx(e));
        }
        catch (ex) {
          (this.ctx?.log?.error || console.error)(`plugin ${e.plugin.id} onStop`, safeErrorMessage(ex, e.config));
        }
      }
    }
    this.started = false;
  }

  makePluginCtx(entry) {
    const base = this.ctx || {};
    const botName =
      (entry.plugin.botName && String(entry.plugin.botName).trim()) ||
      (entry.plugin.name && String(entry.plugin.name).trim()) ||
      entry.plugin.id ||
      "Plugin Bot";
    // Wrap uploadFile so every plugin upload is attributed to this bot identity
    // (distinctive cyan BOT pill in the file list / chat).
    let {uploadFile} = base;
    if (typeof uploadFile === "function") {
      const baseUpload = uploadFile;
      uploadFile = spec =>
        baseUpload(
          Object.assign({}, spec || {}, {
            botName: (spec && spec.botName) || botName,
            role: (spec && spec.role) || "bot",
            meta: Object.assign(
              {
                plugin: entry.plugin.id,
                bot: true,
                botName,
              },
              (spec && spec.meta) || {},
            ),
          }),
        );
    }
    let hobbyfiles = base.hobbyfiles || base.dicefiles;
    if (
      hobbyfiles &&
      typeof hobbyfiles === "object" &&
      typeof hobbyfiles.postMessage === "function"
    ) {
      const basePostMessage = hobbyfiles.postMessage.bind(hobbyfiles);
      hobbyfiles = Object.assign({}, hobbyfiles, {
        postMessage(spec) {
          return basePostMessage(
            Object.assign({}, spec || {}, {
              botName: spec && spec.botName || botName,
              pluginId: spec && spec.pluginId || entry.plugin.id,
            }),
          );
        },
      });
    }
    hobbyfiles = require("./scoped-api").scopedPluginApi(hobbyfiles, { roomId: entry.config?.roomId, pluginId: entry.plugin.id, botName });
    uploadFile = require("./scoped-api").scopedUpload(uploadFile, entry.config?.roomId, { pluginId: entry.plugin.id, botName });
    const state = base.createPluginState?.({ roomId: entry.config?.roomId, pluginId: entry.plugin.id });
    return Object.assign({}, base, {
      pluginId: entry.plugin.id,
      pluginName: entry.plugin.name || entry.plugin.id,
      botName,
      config: entry.config,
      enabled: entry.enabled,
      uploadFile,
      hobbyfiles,
      dicefiles: hobbyfiles,
      apiVersion: 2,
      state,
      report: state ? require("./reports").createPluginReport(state, entry.config) : undefined,
      createPluginState: undefined,
      connections: base.createPluginConnections?.({ roomId: entry.config?.roomId, pluginId: entry.plugin.id }),
      createPluginConnections: undefined,
      jobs: entry.config?.roomId ? base.createPluginJobs?.({ roomId: entry.config.roomId, pluginId: entry.plugin.id, config: entry.config, global: true }) : undefined,
      createPluginJobs: undefined,
      scheduleRun: base.createPluginJobs && entry.config?.roomId ? (id, args) => {
        if (id !== entry.plugin.id || !entry.enabled) {
          return;
        }
        const bucket = Math.floor(Date.now() / (Math.max(1, Number(entry.config.pollIntervalMinutes) || 5) * 60000));
        return base.createPluginJobs({ roomId: entry.config.roomId, pluginId: entry.plugin.id, config: entry.config, global: true }).enqueue({ idempotencyKey: `${args?.reason || "event"}:${args?.payload?.key || bucket}` });
      } : base.scheduleRun,
    });
  }

  /**
   * Fan-out a webhook-style event to plugin hooks.
   * @param {string} event
   * @param {object} payload
   */
  async emitEvent(event, payload) {
    for (const e of this.entries.values()) {
      if (!e.enabled) {
        continue;
      }
      const onEvent = e.plugin.hooks && e.plugin.hooks.onEvent;
      if (typeof onEvent !== "function") {
        continue;
      }
      try {
        await onEvent(event, payload, this.makePluginCtx(e));
      }
      catch (ex) {
        (this.ctx?.log?.error || console.error)(`plugin ${e.plugin.id} onEvent(${event})`, safeErrorMessage(ex, e.config));
      }
    }
  }

  /**
   * Run imperative plugin entry (e.g. Mega.nz sync).
   * @param {string} id
   * @param {object} [args]
   */
  async run(id, args) {
    id = normalizePluginId(id);
    const e = this.entries.get(id);
    if (!e) {
      throw new Error(`plugin not registered: ${id}`);
    }
    if (!e.enabled) {
      throw new Error(`plugin disabled: ${id}`);
    }
    if (typeof e.plugin.run !== "function") {
      throw new Error(`plugin has no run(): ${id}`);
    }
    const runArgs = args || {};
    if (runArgs.mode && !(e.plugin.runModes || []).includes(runArgs.mode)) {
      throw Object.assign(new Error("This bot does not support that run mode. Check its catalog entry."), { status: 400 });
    }
    const ctx = this.makePluginCtx(e);
    ctx.executingJob = !!runArgs.job;
    if (runArgs.signal instanceof AbortSignal) {
      ctx.signal = runArgs.signal;
    }
    const reason = String(runArgs.reason || "manual");
    const roomId = String(e.config && e.config.roomId || "global");
    let eventId = "";
    if (reason !== "manual" && reason !== "job") {
      const {payload} = runArgs;
      const stableId =
        payload && (payload.eventId || payload.key || payload.id);
      const minutes =
        reason === "poll" ?
          Math.max(1, Number(e.config.pollIntervalMinutes) || 1) :
          5;
      eventId = stableId ?
        `${reason}:${stableId}` :
        `${reason}:${Math.floor(Date.now() / (minutes * 60 * 1000))}`;
    }
    let lease = null;
    if (eventId && ctx.events && typeof ctx.events.begin === "function") {
      lease = await ctx.events.begin(
        `global-plugin-run:${roomId}:${id}`,
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
    const startedAt = Date.now();
    let activeLease = null;
    let guard;
    if (e.running) {
      if (lease) {
        await ctx.events.fail(lease);
      }
      return { skipped: true, reason: "already_running" };
    }
    e.running = true;
    try {
      if (ctx.events && typeof ctx.events.begin === "function") {
        activeLease = await ctx.events.begin(`plugin-active:${roomId}::${id}`, "active", { leaseSeconds: 900 });
        if (!activeLease) {
          if (lease) {
            await ctx.events.fail(lease);
          }
          return { skipped: true, reason: "already_running" };
        }
      }
      guard = require("./run-guard").guardPluginRun(ctx, [activeLease, lease]);
      const result = await e.plugin.run(ctx, runArgs);
      await guard.assertOwned();
      if (result?.report && ctx.report) {
        await ctx.report.write(result.report);
      }
      if (lease && typeof ctx.events.complete === "function") {
        await ctx.events.complete(lease);
      }
      await defaultPluginRunStatus.record(completedRunStatus({
        roomId,
        pluginId: id,
        reason,
        startedAt,
        finishedAt: Date.now(),
        ok: true,
        result,
      })).catch(() => {});
      return result;
    }
    catch (failure) {
      const error = failure instanceof Error ? failure : new Error(safeErrorMessage(failure, e.config));
      error.message = safeErrorMessage(error, e.config);
      if (lease && typeof ctx.events.fail === "function") {
        await Promise.resolve(ctx.events.fail(lease)).catch(() => {});
      }
      await defaultPluginRunStatus.record(completedRunStatus({
        roomId,
        pluginId: id,
        reason,
        startedAt,
        finishedAt: Date.now(),
        ok: false,
        error: error && error.message,
      })).catch(() => {});
      throw error;
    }
    finally {
      guard?.stop();
      e.running = false;
      if (activeLease) {
        await Promise.resolve(ctx.events.fail(activeLease)).catch(() => {});
      }
    }
  }
}

/** Singleton for process workers */
const defaultRegistry = new PluginRegistry();

module.exports = {
  BUILTIN_IDS,
  normalizePluginConfigs,
  resolvePluginModulePath,
  loadPluginModule,
  validatePluginShape,
  PluginRegistry,
  defaultRegistry,
};
