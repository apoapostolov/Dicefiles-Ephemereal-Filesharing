"use strict";

const {
  resolveSyncLog,
  syncLogScope,
  syncLogEntryKey,
} = require("../sync-log");

const PLUGIN_ID = "remote-import";
const DEFAULT_BOT_NAME = "Remote Import";
const DEFAULT_MAX_FILES_PER_RUN = 50;
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024 * 1024;
const DEFAULT_MAX_BYTES_PER_RUN = 1024 * 1024 * 1024;

const configSchema = {
  type: "object",
  required: ["urls", "roomId"],
  properties: {
    urls: {
      type: "array",
      items: { type: "string" },
      description: "Mega.nz or Pixeldrain URLs, separated by commas",
    },
    providers: {
      type: "array",
      items: { type: "string", enum: ["mega", "pixeldrain"] },
      description: "Allowed providers (default: every installed provider)",
    },
    roomId: {
      type: "string",
      description: "Destination Dicefiles room",
    },
    pixeldrainApiKey: {
      type: "string",
      format: "password",
      writeOnly: true,
      description: "Optional Pixeldrain API key",
    },
    megaEmail: {
      type: "string",
      description: "Optional Mega.nz account email",
    },
    megaPassword: {
      type: "string",
      format: "password",
      writeOnly: true,
      description: "Optional Mega.nz account password; prefer environment",
    },
    namePrefix: {
      type: "string",
      description: "Optional prefix for imported filenames",
    },
    botName: {
      type: "string",
      description: "Uploader display name",
    },
    pollIntervalMinutes: {
      type: "number",
      minimum: 0,
      description: "Minutes between scans; 0 means manual only",
    },
    maxFilesPerRun: {
      type: "number",
      minimum: 1,
      description: "Maximum new files per scan",
    },
    maxBytesPerFile: {
      type: "number",
      minimum: 1,
      description: "Maximum bytes in one imported file",
    },
    maxBytesPerRun: {
      type: "number",
      minimum: 1,
      description: "Maximum combined bytes in one scan",
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

function normalizedUrls(config) {
  return Array.isArray(config && config.urls)
    ? config.urls.map((url) => String(url).trim()).filter(Boolean)
    : [];
}

function sourceGroupKey(config) {
  return normalizedUrls(config).slice().sort().join("\n");
}

function validateConfig(config) {
  const errors = [];
  const urls = normalizedUrls(config);
  if (!urls.length) {
    errors.push("at least one remote URL is required");
  }
  for (const value of urls) {
    try {
      const parsed = new URL(value);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        errors.push("remote URLs must use HTTP or HTTPS");
      }
      if (parsed.username || parsed.password) {
        errors.push("credentials are not allowed in remote URLs");
      }
    } catch (_) {
      errors.push(`invalid remote URL: ${value}`);
    }
  }
  if (!config || !config.roomId || String(config.roomId).length < 4) {
    errors.push("roomId is required");
  }
  for (const field of [
    "maxFilesPerRun",
    "maxBytesPerFile",
    "maxBytesPerRun",
  ]) {
    if (
      config &&
      config[field] != null &&
      positiveInteger(config[field], 1) == null
    ) {
      errors.push(`${field} must be a positive whole number`);
    }
  }
  return { ok: !errors.length, errors };
}

async function runRemoteImport(ctx, args) {
  const config = Object.assign(
    {},
    (ctx && ctx.config) || {},
    (args && args.config) || {},
  );
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(`remote-import config: ${validation.errors.join("; ")}`);
  }
  if (
    !ctx ||
    !ctx.remoteDownloaders ||
    typeof ctx.remoteDownloaders.listFolder !== "function"
  ) {
    throw new Error("remote-import requires ctx.remoteDownloaders");
  }
  if (typeof ctx.uploadFile !== "function") {
    throw new Error("remote-import requires ctx.uploadFile");
  }

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
  const syncLog = resolveSyncLog(ctx);
  const scope = syncLogScope(
    PLUGIN_ID,
    config.roomId,
    sourceGroupKey(config),
  );
  await syncLog.prune(scope, Date.now());

  const result = {
    uploaded: 0,
    uploadedBytes: 0,
    skipped: 0,
    skippedByReason: {
      alreadyImported: 0,
      fileLimit: 0,
      fileTooLarge: 0,
      runSizeLimit: 0,
      existingRoom: 0,
      directory: 0,
    },
    files: [],
  };
  const botName =
    String(config.botName || ctx.botName || DEFAULT_BOT_NAME).trim() ||
    DEFAULT_BOT_NAME;

  for (const sourceUrl of normalizedUrls(config)) {
    const { provider, entries } = await ctx.remoteDownloaders.listFolder(
      sourceUrl,
      providerCredentials(providerIdFromUrl(sourceUrl), config),
      config.providers,
    );
    for (const entry of entries) {
      if (!entry || !entry.name || entry.isDir) {
        result.skipped++;
        result.skippedByReason.directory++;
        continue;
      }
      if (result.uploaded >= maxFilesPerRun) {
        result.skipped++;
        result.skippedByReason.fileLimit++;
        continue;
      }
      const name = `${config.namePrefix || ""}${entry.name}`;
      const dedupeKey = syncLogEntryKey(
        name,
        entry.size,
        entry.sourceId || `${provider.id}:${sourceUrl}:${entry.name}`,
      );
      if (await syncLog.has(scope, dedupeKey)) {
        result.skipped++;
        result.skippedByReason.alreadyImported++;
        continue;
      }
      const declaredSize = Number(entry.size);
      if (Number.isFinite(declaredSize) && declaredSize > maxBytesPerFile) {
        result.skipped++;
        result.skippedByReason.fileTooLarge++;
        continue;
      }
      if (
        Number.isFinite(declaredSize) &&
        result.uploadedBytes + declaredSize > maxBytesPerRun
      ) {
        result.skipped++;
        result.skippedByReason.runSizeLimit++;
        continue;
      }
      const body =
        typeof entry.openStream === "function"
          ? await entry.openStream()
          : typeof entry.download === "function"
            ? await entry.download()
            : null;
      if (!body) {
        throw new Error(`${provider.id} did not provide file bytes`);
      }
      let upload;
      try {
        upload = await ctx.uploadFile({
          roomId: config.roomId,
          name,
          body,
          size: entry.size,
          maxBytes: Math.min(
            maxBytesPerFile,
            Math.max(1, maxBytesPerRun - result.uploadedBytes),
          ),
          skipIfRoomHashExists: true,
          botName,
          role: "bot",
          meta: {
            plugin: PLUGIN_ID,
            provider: provider.id,
            sourceId: dedupeKey,
            bot: true,
            botName,
          },
        });
      } catch (error) {
        if (error && error.code === "DUPLICATE_ROOM_CONTENT") {
          await syncLog.mark(scope, dedupeKey, Date.now());
          result.skipped++;
          result.skippedByReason.existingRoom++;
          continue;
        }
        if (error && error.code === "PLUGIN_UPLOAD_TOO_LARGE") {
          result.skipped++;
          result.skippedByReason.fileTooLarge++;
          continue;
        }
        throw error;
      }
      const size = Number(upload && upload.size) || declaredSize || 0;
      result.uploaded++;
      result.uploadedBytes += size;
      result.files.push({ name, size, key: upload && upload.key });
      await syncLog.mark(scope, dedupeKey, Date.now());
    }
  }
  return result;
}

function providerIdFromUrl(sourceUrl) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (host === "pixeldrain.com" || host === "www.pixeldrain.com") {
    return "pixeldrain";
  }
  if (host === "mega.nz" || host === "mega.co.nz") {
    return "mega";
  }
  return "";
}

function providerCredentials(providerId, config) {
  if (providerId === "pixeldrain") {
    return {
      apiKey:
        config.pixeldrainApiKey || process.env.PIXELDRAIN_API_KEY || "",
    };
  }
  if (providerId === "mega") {
    return {
      email: config.megaEmail || process.env.MEGA_EMAIL || "",
      password: config.megaPassword || process.env.MEGA_PASSWORD || "",
    };
  }
  return {};
}

const plugin = {
  id: PLUGIN_ID,
  name: "Remote Host Import",
  botName: DEFAULT_BOT_NAME,
  version: "0.1.0",
  description:
    "Import bounded files from enabled third-party hosts. Pixeldrain file and list links are supported first.",
  configSchema,
  validateConfig,
  syncLog: {
    label: "Imported remote files",
    scope(config) {
      return syncLogScope(
        PLUGIN_ID,
        config && config.roomId,
        sourceGroupKey(config),
      );
    },
  },
  run: runRemoteImport,
};

module.exports = plugin;
module.exports.runRemoteImport = runRemoteImport;
module.exports.validateConfig = validateConfig;
module.exports._test = {
  normalizedUrls,
  sourceGroupKey,
  providerIdFromUrl,
  providerCredentials,
};
