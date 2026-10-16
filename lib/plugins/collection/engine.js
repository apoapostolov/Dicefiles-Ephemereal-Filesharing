"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");
const { Transform } = require("node:stream");
const policy = require("../import-policy");
const { defaultPluginConfig } = require("../../../common/plugin-config");
const { resolveSyncLog, syncLogScope, syncLogEntryKey } = require("../sync-log");
const { createCollectionNetwork } = require("./network");

const hash = value => createHash("sha256").update(String(value)).digest("hex");
const commonProperties = {
  ...policy.properties,
  pollIntervalMinutes: { type: "number", minimum: 0, maximum: 10080, default: 30, title: "Scan interval", description: "Minutes between scans; 0 for manual scans" },
  maxFilesPerRun: { type: "number", minimum: 1, maximum: 200, default: 25, title: "Items per scan" },
  maxBytesPerFile: { type: "number", minimum: 1, maximum: 10737418240, default: 268435456, title: "File limit (bytes)" },
  maxBytesPerRun: { type: "number", minimum: 1, maximum: 21474836480, default: 1073741824, title: "Scan limit (bytes)" },
  botName: { type: "string", title: "Bot name" },
};

function defineCollector({ id, name, provider, description, properties, required = [], page, stateFactory, connectionsFactory }) {
  const configSchema = { type: "object", required: ["roomId", ...required], properties: { ...commonProperties, ...properties, roomId: { type: "string" } } };
  const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const sourceFor = (config, settings) => hash(JSON.stringify(canonical({ provider, fields: Object.fromEntries(Object.keys(properties).filter(key => !Object.hasOwn(commonProperties, key)).map(key => [key, config[key]])), settings })));
  const memorySource = input => {
    const config = { ...defaultPluginConfig(configSchema), ...input };
    const connections = (connectionsFactory || require("../connections").createPluginConnections())({ pluginId: id, roomId: config.roomId });
    return sourceFor(config, config.connectionId ? connections.settings(config.connectionId, provider) : {});
  };
  return {
    id, name, botName: name, version: "1.0.0", category: "File collection", description, configSchema,
    runModes: ["preview", "test", "run"], capabilities: ["collect", "preview", "connections", "reports", "jobs"],
    syncLog: {
      label: "Imported source revisions",
      scope(config) {
        return syncLogScope(id, config.roomId, memorySource(config));
      },
      async clearLocal(config) {
        const state = (stateFactory || require("../state").createPluginStateFactory())({ pluginId: id, roomId: config.roomId });
        await state.delete(`collection:${memorySource(config).slice(0, 40)}`);
      },
    },
    validateConfig(input = {}) {
      const c = { ...defaultPluginConfig(configSchema), ...input }; const errors = policy.validate(c);
      for (const field of required) {
        if (!c[field] || Array.isArray(c[field]) && !c[field].length) {
          errors.push(`${configSchema.properties[field]?.title || field} is required.`);
        }
      }
      for (const [key, definition] of Object.entries(configSchema.properties)) {
        if (definition.type === "number" && (!Number.isSafeInteger(c[key]) || c[key] < definition.minimum || c[key] > definition.maximum)) {
          errors.push(`${definition.title || key} must be between ${definition.minimum} and ${definition.maximum}.`);
        }
        if (definition.type === "string" && c[key] != null && (typeof c[key] !== "string" || c[key].length > 2048)) {
          errors.push(`${definition.title || key} must be text with at most 2048 characters.`);
        }
        if (definition.type === "array" && (!Array.isArray(c[key]) || c[key].length > 50 || c[key].some(item => typeof item !== "string" || item.length > 2048))) {
          errors.push(`${definition.title || key} must contain at most 50 text values.`);
        }
        if (definition.enum && !definition.enum.includes(c[key])) {
          errors.push(`Choose a supported ${definition.title || key}.`);
        }
      }
      return { ok: !errors.length, errors };
    },
    async run(ctx, args = {}) {
      const config = { ...defaultPluginConfig(configSchema), ...ctx.config };
      const validation = this.validateConfig(config);
      if (!validation.ok) {
        throw Object.assign(new Error(validation.errors.join(" ")), { retryable: false });
      }
      const preview = args.mode === "preview" || args.mode === "test" || config.dryRun;
      const connection = config.connectionId ? ctx.connections.resolve(config.connectionId, provider) : { credentials: {}, settings: {} };
      const readSource = async operation => {
        try {
          return await operation();
        }
        catch (error) {
          const credentials = Object.fromEntries(Object.values(connection.credentials).map((value, index) => [`secret${index}`, value]));
          const message = require("../metadata").safeErrorMessage(error, { ...config, credentials });

          throw Object.assign(new Error(`${message} Check the provider connection and source settings, then retry.`), { status: error?.status, code: error?.code, retryable: error?.retryable, retryAfterMs: error?.retryAfterMs });
        }
      };
      const net = createCollectionNetwork(ctx);
      const source = sourceFor(config, connection.settings);
      const checkpointKey = `collection:${source.slice(0, 40)}`;
      let checkpoint = (await ctx.state.get(checkpointKey))?.value || {};
      const log = ctx.syncLog || resolveSyncLog(ctx); const scope = syncLogScope(id, config.roomId, source);
      // Provenance in room storage closes the upload/checkpoint crash window.
      const existing = new Set(); let cursor;
      do {
        const inventory = await ctx.dicefiles.listFilesPage({ limit: 500, cursor });
        for (const file of inventory.files) {
          if (file.meta?.pluginSource?.revisionId) {
            existing.add(file.meta.pluginSource.revisionId);
          }
        }
        cursor = inventory.nextCursor;
      } while (cursor);
      const result = { uploaded: 0, uploadedBytes: 0, planned: 0, plannedBytes: 0, skipped: 0, checked: 0, removed: 0, dryRun: preview, report: { title: args.mode === "test" ? `${name}: connection` : `${name}: ${preview ? "preview" : "collection"}`, summary: "", items: [] } };
      let stopped = false;
      for (let pages = 0; pages < 10 && !stopped; pages++) {
        ctx.signal?.throwIfAborted();
        const batch = await readSource(() => page({ config, connection, checkpoint, net, signal: ctx.signal }));
        if (!Array.isArray(batch.entries) || batch.entries.length > 500) {
          throw Object.assign(new Error("The provider returned an invalid or oversized page. Reduce the source scope."), { retryable: false });
        }
        for (const entry of batch.entries) {
          ctx.signal?.throwIfAborted(); result.checked++;
          if (entry.removed) {
            result.removed++; continue;
          }
          const name = [...path.posix.basename(String(entry.name || "download").replace(/\\/g, "/"))].filter(char => char.charCodeAt(0) >= 32).join("").slice(0, 200);
          const revisionId = hash(`${id}\0${source}\0${entry.id}\0${entry.revision || ""}`);
          const dedupe = syncLogEntryKey(name, entry.size, revisionId);
          if (!policy.accepts(config, name) || existing.has(revisionId) || await log.has(scope, dedupe)) {
            result.skipped++; continue;
          }
          const size = Number(entry.size) || 0;
          if (size > config.maxBytesPerFile) {
            result.skipped++; result.report.items.push({ title: name, detail: "Exceeds the file limit. Increase the limit to collect it.", status: "warning" }); continue;
          }
          if (result.planned >= config.maxFilesPerRun || (preview ? result.plannedBytes : result.uploadedBytes) + size > config.maxBytesPerRun) {
            stopped = true; break;
          }
          result.planned++; result.plannedBytes += size;
          if (args.mode === "test") {
            stopped = true; break;
          }
          if (preview) {
            result.report.items.push({ title: name, detail: entry.kind === "link" ? "Link ready to collect" : `${size ? `${size.toLocaleString()} bytes` : "Size checked while streaming"} · ${entry.revision ? "revision tracked" : "source tracked"}` }); continue;
          }
          if (entry.kind === "link") {
            const added = await ctx.dicefiles.addLink({ url: entry.url, title: name, provider, sourceId: `${source}:${entry.id}`, revision: entry.revision });
            if (added.added) {
              result.uploaded++;
            }
            else {
              result.skipped++;
            }
          }
          else {
            const maxBytes = Math.min(config.maxBytesPerFile, config.maxBytesPerRun - result.uploadedBytes);
            const body = await readSource(() => entry.open(maxBytes));
            let bytes = 0;
            const counter = new Transform({ transform(chunk, encoding, callback) {
              bytes += chunk.length;
              callback(bytes > maxBytes ? new Error("Collection byte budget reached. Increase the scan limit or select smaller files.") : null, chunk);
            } });
            body.on("error", error => counter.destroy(error)); body.pipe(counter);
            try {
              const file = await readSource(() => ctx.uploadFile({ roomId: config.roomId, name, body: counter, maxBytes, signal: ctx.signal, botName: config.botName || ctx.botName,
                meta: { pluginSource: { provider, identity: hash(entry.id), revisionId, revision: hash(entry.revision || ""), license: String(entry.license || "").slice(0, 120) } } }));
              result.uploaded++; result.uploadedBytes += bytes;
              result.report.items.push({ title: name, detail: "Collected", href: file.href || `/g/${file.key}`, status: "success" });
            }
            finally {
              body.destroy(); counter.destroy();
            }
          }
          existing.add(revisionId); await log.mark(scope, dedupe);
        }
        if (!preview && !stopped && batch.checkpoint) {
          ({ checkpoint } = batch); await ctx.state.set(checkpointKey, checkpoint);
        }
        else if (batch.checkpoint) {
          ({ checkpoint } = batch);
        }
        if (!batch.hasMore || args.mode === "test") {
          break;
        }
      }
      result.test = args.mode === "test";
      result.report.summary = result.test ? "Connection succeeded. The selected source can be read. No items were imported." : `${preview ? "Ready" : "Collected"}: ${preview ? result.planned : result.uploaded} · skipped: ${result.skipped} · removed at source: ${result.removed}. Source removals never delete room files.`;
      if (stopped && !result.test) {
        result.report.summary += " Scan limit reached; the next scan continues safely.";
      }
      return result;
    },
  };
}

module.exports = { defineCollector, hash, commonProperties };
