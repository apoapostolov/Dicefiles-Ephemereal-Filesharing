"use strict";

/**
 * Mega.nz folder autoshare plugin (first-party).
 *
 * Monitors a Mega.nz folder, downloads new files, and uploads them into a
 * Dicefiles room as the **Mega.nz Autoshare** bot (cyan BOT pill).
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
 *   "botName": "Mega.nz Autoshare"  // optional display name override
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
const DEFAULT_BOT_NAME = "Mega.nz Autoshare";
const DEFAULT_MAX_FILES_PER_RUN = 50;
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024 * 1024;
const DEFAULT_MAX_BYTES_PER_RUN = 1024 * 1024 * 1024;

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
    email: { type: "string", description: "Optional Mega.nz account email" },
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
      description: "Uploader display name (default: Mega.nz Autoshare)",
    },
    pollIntervalMinutes: {
      type: "number",
      description:
        "How often to re-scan the Mega.nz folder (minutes). 0 disables the timer. Startup still runs once when > 0.",
    },
    pollEvents: {
      type: "array",
      items: { type: "string" },
      description:
        "Webhook event names that trigger a background sync (optional)",
    },
    maxFilesPerRun: {
      type: "number",
      description: "Maximum new files imported by one scan (default: 50)",
    },
    maxBytesPerFile: {
      type: "number",
      description:
        "Maximum size of one imported file in bytes (default: 256 MiB)",
    },
    maxBytesPerRun: {
      type: "number",
      description:
        "Maximum combined import size per scan in bytes (default: 1 GiB)",
    },
  },
};

function positiveInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * @param {object} config
 * @returns {{ok: boolean, errors?: string[]}}
 */
function validateConfig(config) {
  const errors = [];
  const c = config || {};
  if (!c.folderUrl || typeof c.folderUrl !== "string") {
    errors.push("folderUrl is required");
  }
  else if (!/mega\.nz/i.test(c.folderUrl)) {
    errors.push("folderUrl must be a Mega.nz URL");
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
  for (const field of [
    "maxFilesPerRun",
    "maxBytesPerFile",
    "maxBytesPerRun",
  ]) {
    if (c[field] != null && positiveInteger(c[field], 1) == null) {
      errors.push(`${field} must be a positive whole number`);
    }
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

function entryDedupeKeys(entry, name) {
  const legacy = syncLogEntryKey(name, entry && entry.size);
  const stable = syncLogEntryKey(
    name,
    entry && entry.size,
    entry && entry.sourceId,
  );
  return Array.from(new Set([stable, legacy]));
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
 * Pure orchestration: list folder → upload each new entry as the Mega.nz bot.
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
      "mega-folder requires ctx.megaDownloader.listFolder (install Mega.nz SDK wiring or inject for tests)",
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
  let uploadedBytes = 0;
  const skippedByReason = {
    invalid: 0,
    directory: 0,
    alreadyImported: 0,
    existingRoom: 0,
    fileLimit: 0,
    fileTooLarge: 0,
    runSizeLimit: 0,
    unavailable: 0,
  };
  const maxFilesPerRun = positiveInteger(
    config.maxFilesPerRun,
    DEFAULT_MAX_FILES_PER_RUN,
  );
  const maxBytesPerFile = positiveInteger(
    config.maxBytesPerFile,
    DEFAULT_MAX_BYTES_PER_FILE,
  );
  const maxBytesPerRun = positiveInteger(
    config.maxBytesPerRun,
    DEFAULT_MAX_BYTES_PER_RUN,
  );
  const priorImports = new Set();
  if (
    ctx &&
    ctx.dicefiles &&
    typeof ctx.dicefiles.listFiles === "function"
  ) {
    try {
      const roomFiles = await ctx.dicefiles.listFiles({
        roomId: config.roomId,
        limit: 500,
      });
      for (const file of roomFiles || []) {
        if (
          file &&
          file.meta &&
          file.meta.plugin === PLUGIN_ID &&
          file.meta.megaFolder === config.folderUrl
        ) {
          if (file.meta.sourceIdHash) {
            priorImports.add(`source:${file.meta.sourceIdHash}`);
          }
          priorImports.add(
            `legacy:${syncLogEntryKey(file.name, file.size)}`,
          );
        }
      }
    }
    catch (error) {
      if (ctx.log && typeof ctx.log.warn === "function") {
        ctx.log.warn(
          `[plugin:${PLUGIN_ID}] could not inspect existing room imports`,
          error,
        );
      }
    }
  }

  for (const entry of entries) {
    if (!entry || !entry.name) {
      skipped++;
      skippedByReason.invalid++;
      continue;
    }
    if (entry.isDir) {
      skipped++;
      skippedByReason.directory++;
      continue;
    }
    const name = `${prefix}${entry.name}`;
    const dkeys = entryDedupeKeys(entry, name);
    const primaryKey = dkeys[0];
    const stableKey = dkeys.find(key => key.startsWith("source:"));
    const legacyKey = syncLogEntryKey(name, entry.size);

    if (dkeys.some(key => localSeen.has(key))) {
      skipped++;
      skippedByReason.alreadyImported++;
      continue;
    }
    let logged = false;
    for (const key of dkeys) {
      if (await syncLog.has(logScope, key)) {
        logged = true;
        break;
      }
    }
    if (logged) {
      dkeys.forEach(key => localSeen.add(key));
      skipped++;
      skippedByReason.alreadyImported++;
      continue;
    }
    if (
      (stableKey && priorImports.has(stableKey)) ||
      priorImports.has(`legacy:${legacyKey}`)
    ) {
      const now = Date.now();
      dkeys.forEach(key => localSeen.add(key));
      await syncLog.mark(logScope, primaryKey, now);
      skipped++;
      skippedByReason.existingRoom++;
      continue;
    }
    if (uploaded >= maxFilesPerRun) {
      skipped++;
      skippedByReason.fileLimit++;
      continue;
    }
    const declaredSize = Number(entry.size);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytesPerFile) {
      skipped++;
      skippedByReason.fileTooLarge++;
      continue;
    }
    if (
      Number.isFinite(declaredSize) &&
      uploadedBytes + declaredSize > maxBytesPerRun
    ) {
      skipped++;
      skippedByReason.runSizeLimit++;
      continue;
    }

    let body;
    if (typeof entry.openStream === "function") {
      body = await entry.openStream();
    }
    if (!body) {
      if (typeof entry.download === "function") {
        body = await entry.download();
      }
      else if (entry.buffer) {
        body = entry.buffer;
      }
      else if (downloader.downloadEntry) {
        body = await downloader.downloadEntry(entry, credentials);
      }
      else {
        skipped++;
        skippedByReason.unavailable++;
        continue;
      }
    }
    const actualSize =
      Buffer.isBuffer(body) || body instanceof Uint8Array ?
        body.byteLength :
        Number.isFinite(declaredSize) ?
          declaredSize :
          0;
    if (actualSize > maxBytesPerFile) {
      skipped++;
      skippedByReason.fileTooLarge++;
      continue;
    }
    if (uploadedBytes + actualSize > maxBytesPerRun) {
      skipped++;
      skippedByReason.runSizeLimit++;
      continue;
    }
    let result;
    try {
      result = await uploadFile({
        roomId: config.roomId,
        name,
        body,
        size: entry.size != null ? entry.size : undefined,
        maxBytes: Math.min(
          maxBytesPerFile,
          Math.max(1, maxBytesPerRun - uploadedBytes),
        ),
        skipIfRoomHashExists: true,
        botName,
        role: "bot",
        meta: {
          plugin: PLUGIN_ID,
          megaFolder: config.folderUrl,
          sourceIdHash: stableKey ? stableKey.slice("source:".length) : "",
          bot: true,
          botName,
          source: "mega.nz",
        },
      });
    }
    catch (error) {
      if (error && error.code === "DUPLICATE_ROOM_CONTENT") {
        const now = Date.now();
        dkeys.forEach(key => localSeen.add(key));
        await syncLog.mark(logScope, primaryKey, now);
        skipped++;
        skippedByReason.existingRoom++;
        continue;
      }
      if (error && error.code === "PLUGIN_UPLOAD_TOO_LARGE") {
        skipped++;
        skippedByReason.fileTooLarge++;
        continue;
      }
      throw error;
    }
    const now = Date.now();
    dkeys.forEach(key => localSeen.add(key));
    await syncLog.mark(logScope, primaryKey, now);
    uploaded++;
    const storedSize = Number(result && result.size) || actualSize;
    uploadedBytes += storedSize;
    files.push({
      name,
      key: result && result.key,
      size: storedSize || entry.size,
    });
  }

  return {
    uploaded,
    uploadedBytes,
    skipped,
    skippedByReason,
    files,
    limits: {
      maxFilesPerRun,
      maxBytesPerFile,
      maxBytesPerRun,
    },
  };
}

const plugin = {
  id: PLUGIN_ID,
  name: "Mega.nz Autoshare",
  botName: DEFAULT_BOT_NAME,
  version: "1.2.0",
  description:
    "Monitor a Mega.nz folder, download new files over time, and auto-share them into a Dicefiles room as the Mega.nz Autoshare bot.",
  configSchema,
  validateConfig,
  syncLog: {
    label: "Imported Mega.nz files",
    scope(config) {
      return syncLogScope(
        PLUGIN_ID,
        config && config.roomId,
        config && config.folderUrl,
      );
    },
    clearLocal(config) {
      seenByScope.delete(scopeKey(config || {}));
    },
  },
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
          }
          catch (ex) {
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
module.exports.DEFAULT_LIMITS = {
  maxFilesPerRun: DEFAULT_MAX_FILES_PER_RUN,
  maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
  maxBytesPerRun: DEFAULT_MAX_BYTES_PER_RUN,
};
module.exports._test = {
  clearPollTimer,
  pollTimers,
  seenByScope,
  getLocalSeenSet,
  entryDedupeKeys,
  scopeKey,
};
