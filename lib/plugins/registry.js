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

const BUILTIN_IDS = Object.freeze([
  "mega-folder",
  "discord-release",
  "telegram-release",
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
    const id = String(item.id || item.name || "")
      .trim()
      .toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      enabled: item.enabled !== false,
      config:
        item.config && typeof item.config === "object" && !Array.isArray(item.config)
          ? Object.assign({}, item.config)
          : {},
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
  } catch (ex) {
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
      if (opts && opts.onlyEnabled !== false && !item.enabled) {
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
      } catch (ex) {
        errors.push({ id: item.id, error: ex.message || String(ex) });
      }
    }
    return { loaded, errors };
  }

  list() {
    return Array.from(this.entries.values()).map((e) => ({
      id: e.plugin.id,
      name: e.plugin.name,
      version: e.plugin.version || "0.0.0",
      description: e.plugin.description || "",
      enabled: e.enabled,
      config: e.config,
      capabilities: Array.isArray(e.plugin.capabilities)
        ? e.plugin.capabilities.slice()
        : [],
      eventSubscriptions: Array.isArray(e.plugin.eventSubscriptions)
        ? e.plugin.eventSubscriptions.slice()
        : [],
    }));
  }

  get(id) {
    return this.entries.get(id) || null;
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
        await e.plugin.hooks.onStart(this.makePluginCtx(e));
      }
    }
  }

  async stopAll() {
    for (const e of this.entries.values()) {
      if (e.plugin.hooks && typeof e.plugin.hooks.onStop === "function") {
        try {
          await e.plugin.hooks.onStop(this.makePluginCtx(e));
        } catch (ex) {
          console.error(`plugin ${e.plugin.id} onStop`, ex);
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
    let uploadFile = base.uploadFile;
    if (typeof uploadFile === "function") {
      const baseUpload = uploadFile;
      uploadFile = (spec) =>
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
              botName: spec && spec.botName || botName,
              pluginId: spec && spec.pluginId || entry.plugin.id,
            }),
          );
        },
      });
    }
    return Object.assign({}, base, {
      pluginId: entry.plugin.id,
      pluginName: entry.plugin.name || entry.plugin.id,
      botName,
      config: entry.config,
      enabled: entry.enabled,
      uploadFile,
      dicefiles,
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
      } catch (ex) {
        console.error(`plugin ${e.plugin.id} onEvent(${event})`, ex);
      }
    }
  }

  /**
   * Run imperative plugin entry (e.g. Mega.nz sync).
   * @param {string} id
   * @param {object} [args]
   */
  async run(id, args) {
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
    return e.plugin.run(this.makePluginCtx(e), args || {});
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
