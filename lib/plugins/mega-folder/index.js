"use strict";

/**
 * Mega.nz folder autoshare plugin (first-party).
 *
 * Monitors a Mega.nz folder, downloads new files, and uploads them into a
 * Dicefiles room as the **Mega Autoshare** bot (cyan BOT pill).
 *
 * Config:
 * {
 *   "folderUrl": "https://mega.nz/folder/...",
 *   "roomId": "targetRoomId",
 *   "email": optional,
 *   "password": optional,   // prefer env MEGA_PASSWORD
 *   "pollIntervalMinutes": 15,  // 0 = no timer; use pollEvents / manual run
 *   "pollEvents": ["file_uploaded"],  // optional: also re-sync on webhook events
 *   "namePrefix": "",
 *   "botName": "Mega Autoshare"  // optional display name override
 * }
 *
 * Already-synced files are remembered in a durable log (Redis ZSET) for
 * `pluginSyncLogRetentionDays` (app config, default 30 days) so restarts do
 * not re-upload. Tests inject ctx.syncLog.
 *
 * Network I/O is injected via ctx.megaDownloader for tests:
 *   megaDownloader.listFolder(folderUrl, credentials) -> Promise<Array<{name, size, download}>>
 *
 * Upload via ctx.uploadFile({ roomId, name, body, size, meta }) — attributed as bot.
 */

const {
  resolveSyncLog,
  syncLogScope,
  syncLogEntryKey,
} = require("../sync-log");

const PLUGIN_ID = "mega-folder";
const DEFAULT_BOT_NAME = "Mega Autoshare";

/** @type {Map<string, NodeJS.Timeout>} */
const pollTimers = new Map();

/** Process-local mirror of durable log (hot path); Redis is source of truth. */
const seenByScope = new Map();

const configSchema = {
  type: "object",
  required: ["folderUrl", "roomId"],
  properties: {
    folderUrl: {
      type: "string",
      description: "Mega.nz public or account folder URL",
    },
    roomId: {
      type: "string",
      description: "Destination Dicefiles room id for uploads",
    },
    email: { type: "string", description: "Optional Mega account email" },
    password: {
      type: "string",
      description: "Optional; prefer process env MEGA_PASSWORD",
    },
    namePrefix: {
      type: "string",
      description: "Optional prefix applied to uploaded filenames",
    },
    botName: {
      type: "string",
      description: "Uploader display name (default: Mega Autoshare)",
    },
    pollIntervalMinutes: {
      type: "number",
      description:
        "How often to re-scan the Mega folder (minutes). 0 disables the timer. Startup still runs once when > 0.",
    },
    pollEvents: {
      type: "array",
      items: { type: "string" },
      description:
        "Webhook event names that trigger a background sync (optional)",
    },
  },
};

/**
 * @param {object} config
 * @returns {{ok: boolean, errors?: string[]}}
 */
function validateConfig(config) {
  const errors = [];
  const c = config || {};
  if (!c.folderUrl || typeof c.folderUrl !== "string") {
    errors.push("folderUrl is required");
  } else if (!/mega\.nz/i.test(c.folderUrl)) {
    errors.push("folderUrl must be a mega.nz URL");
  }
  if (!c.roomId || typeof c.roomId !== "string" || c.roomId.length < 4) {
    errors.push("roomId is required (valid room id)");
  }
  if (c.pollEvents != null && !Array.isArray(c.pollEvents)) {
    errors.push("pollEvents must be an array of event names");
  }
  if (
    c.pollIntervalMinutes != null &&
    (!Number.isFinite(Number(c.pollIntervalMinutes)) ||
      Number(c.pollIntervalMinutes) < 0)
  ) {
    errors.push("pollIntervalMinutes must be a non-negative number");
  }
  return { ok: !errors.length, errors };
}

function scopeKey(config) {
  return `${config.roomId || ""}|${config.folderUrl || ""}`;
}

function getLocalSeenSet(config) {
  const k = scopeKey(config);
  let s = seenByScope.get(k);
  if (!s) {
    s = new Set();
    seenByScope.set(k, s);
  }
  return s;
}

function entryDedupeKey(entry, name) {
  return syncLogEntryKey(name, entry && entry.size);
}

function clearPollTimer(config) {
  const k = scopeKey(config || {});
  const t = pollTimers.get(k);
  if (t) {
    clearInterval(t);
    pollTimers.delete(k);
  }
}

/**
 * Pure orchestration: list folder → upload each new entry as the Mega bot.
 * @param {object} ctx
 * @param {object} [args]
 * @returns {Promise<{uploaded: number, skipped: number, files: object[]}>}
 */
async function runMegaFolderSync(ctx, args) {
  const config = Object.assign(
    {},
    (ctx && ctx.config) || {},
    (args && args.config) || {},
  );
  const v = validateConfig(config);
  if (!v.ok) {
    throw new Error(`mega-folder config: ${v.errors.join("; ")}`);
  }
  const downloader = (ctx && ctx.megaDownloader) || null;
  if (!downloader || typeof downloader.listFolder !== "function") {
    throw new Error(
      "mega-folder requires ctx.megaDownloader.listFolder (install mega SDK wiring or inject for tests)",
    );
  }
  const uploadFile = ctx && ctx.uploadFile;
  if (typeof uploadFile !== "function") {
    throw new Error("mega-folder requires ctx.uploadFile");
  }

  const credentials = {
    email: config.email || process.env.MEGA_EMAIL || "",
    password: config.password || process.env.MEGA_PASSWORD || "",
  };
  const entries = await downloader.listFolder(config.folderUrl, credentials);
  if (!Array.isArray(entries)) {
    throw new Error("listFolder must return an array");
  }

  const prefix = typeof config.namePrefix === "string" ? config.namePrefix : "";
  const botName =
    (config.botName && String(config.botName).trim()) ||
    (ctx && ctx.botName) ||
    DEFAULT_BOT_NAME;

  const localSeen = getLocalSeenSet(config);
  const syncLog = resolveSyncLog(ctx);
  const logScope = syncLogScope(PLUGIN_ID, config.roomId, config.folderUrl);
  // Drop expired entries occasionally (best-effort)
  await syncLog.prune(logScope, Date.now()).catch(() => {});

  const files = [];
  let uploaded = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry || !entry.name) {
      skipped++;
      continue;
    }
    if (entry.isDir) {
      skipped++;
      continue;
    }
    const name = `${prefix}${entry.name}`;
    const dkey = entryDedupeKey(entry, name);

    if (localSeen.has(dkey)) {
      skipped++;
      continue;
    }
    if (await syncLog.has(logScope, dkey)) {
      localSeen.add(dkey);
      skipped++;
      continue;
    }

    let body;
    if (typeof entry.download === "function") {
      body = await entry.download();
    } else if (entry.buffer) {
      body = entry.buffer;
    } else if (downloader.downloadEntry) {
      body = await downloader.downloadEntry(entry, credentials);
    } else {
      skipped++;
      continue;
    }
    const result = await uploadFile({
      roomId: config.roomId,
      name,
      body,
      size: entry.size != null ? entry.size : undefined,
      botName,
      role: "bot",
      meta: {
        plugin: PLUGIN_ID,
        megaFolder: config.folderUrl,
        bot: true,
        botName,
        source: "mega.nz",
      },
    });
    const now = Date.now();
    localSeen.add(dkey);
    await syncLog.mark(logScope, dkey, now);
    uploaded++;
    files.push({
      name,
      key: result && result.key,
      size: entry.size,
    });
  }

  return { uploaded, skipped, files };
}

const plugin = {
  id: PLUGIN_ID,
  name: "Mega Autoshare",
  botName: DEFAULT_BOT_NAME,
  version: "1.2.0",
  description:
    "Monitor a Mega.nz folder, download new files over time, and auto-share them into a Dicefiles room as the Mega Autoshare bot.",
  configSchema,
  validateConfig,
  hooks: {
    async onStart(ctx) {
      const config = (ctx && ctx.config) || {};
      if (ctx && ctx.log) {
        ctx.log.info(
          `[plugin:${PLUGIN_ID}] started as bot "${ctx.botName || DEFAULT_BOT_NAME}" for room ${config.roomId || "?"}`,
        );
      }
      clearPollTimer(config);
      const mins = Number(config.pollIntervalMinutes) || 0;
      if (mins > 0 && ctx && typeof ctx.scheduleRun === "function") {
        // Immediate scan so new processes pick up existing folder contents once
        ctx.scheduleRun(PLUGIN_ID, { reason: "startup" });
        const ms = Math.max(1, mins) * 60 * 1000;
        const t = setInterval(() => {
          try {
            ctx.scheduleRun(PLUGIN_ID, { reason: "poll" });
          } catch (ex) {
            if (ctx.log) {
              ctx.log.error(`[plugin:${PLUGIN_ID}] poll schedule`, ex);
            }
          }
        }, ms);
        if (typeof t.unref === "function") {
          t.unref();
        }
        pollTimers.set(scopeKey(config), t);
        if (ctx.log) {
          ctx.log.info(
            `[plugin:${PLUGIN_ID}] monitoring folder every ${mins} min`,
          );
        }
      }
    },
    async onStop(ctx) {
      clearPollTimer((ctx && ctx.config) || {});
      if (ctx && ctx.log) {
        ctx.log.info(`[plugin:${PLUGIN_ID}] stopped`);
      }
    },
    async onEvent(event, payload, ctx) {
      const poll = (ctx.config && ctx.config.pollEvents) || [];
      if (!Array.isArray(poll) || !poll.includes(event)) {
        return;
      }
      if (ctx && typeof ctx.scheduleRun === "function") {
        ctx.scheduleRun(PLUGIN_ID, { reason: event, payload });
      }
    },
  },
  run: runMegaFolderSync,
};

module.exports = plugin;
module.exports.runMegaFolderSync = runMegaFolderSync;
module.exports.validateConfig = validateConfig;
module.exports.configSchema = configSchema;
module.exports.DEFAULT_BOT_NAME = DEFAULT_BOT_NAME;
module.exports._test = {
  clearPollTimer,
  pollTimers,
  seenByScope,
  getLocalSeenSet,
  entryDedupeKey,
  scopeKey,
};
