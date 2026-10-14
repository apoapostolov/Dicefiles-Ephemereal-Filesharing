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
      description: "Mega.nz, Pixeldrain, Gofile, or enabled Plowshare URLs, separated by commas",
    },
    providers: {
      type: "array",
      items: { type: "string", enum: ["mega", "pixeldrain", "gofile", "plowshare"] },
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
    gofileApiToken: { type: "string", format: "password", writeOnly: true, description: "Gofile Premium API token (or GOFILE_API_TOKEN environment variable)" },
    gofileFolderPassword: { type: "string", format: "password", writeOnly: true, description: "Gofile folder password" },
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
  return Array.isArray(config && config.urls) ?
    config.urls.map(url => String(url).trim()).filter(Boolean) :
    [];
}

function sourceGroupKey(config) {
  return normalizedUrls(config).slice().sort().join("\n");
}

function validateConfig(config) {
  const errors = [];
  const urls = normalizedUrls(config);
  if (urls.length > 20) {
    errors.push("at most 20 sources are allowed");
  }
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
    }
    catch (_) {
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

async function *fairEntries(ctx, config, signal) {
  const urls = normalizedUrls(config);
  const turn = ctx.remoteDownloaders.nextTurn ? await ctx.remoteDownloaders.nextTurn(`${config.roomId}:${sourceGroupKey(config)}`, urls.length) : 0;
  const ordered = urls.slice(turn).concat(urls.slice(0, turn));
  const streams = ordered.map(sourceUrl => {
    const credentials = providerCredentials(providerIdFromUrl(sourceUrl), config);
    if (ctx.remoteDownloaders.entries) {
      return (async function *() {
        for await (const item of ctx.remoteDownloaders.entries(sourceUrl, credentials, config.providers, { signal })) {
          yield { ...item, sourceUrl };
        }
      })();
    }
    return (async function *() {
      const { provider, entries } = await ctx.remoteDownloaders.listFolder(sourceUrl, credentials, config.providers);
      for (const entry of entries) {
        yield { provider, entry, sourceUrl };
      }
    })();
  });
  try {
    while (streams.length) {
      for (let i = 0; i < streams.length;) {
        if (signal) {
          signal.throwIfAborted();
        }
        try {
          const next = await streams[i].next();
          if (next.done) {
            streams.splice(i, 1); continue;
          }
          yield next.value;
        }
        catch (error) {
          if (signal && signal.aborted) {
            throw error;
          }
          streams.splice(i, 1);
          yield { error: error.code || "PROVIDER_FAILED" };
          continue;
        }
        i++;
      }
    }
  }
  finally {
    await Promise.allSettled(streams.map(stream => stream.return()));
  }
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

  const signal = args && args.signal ? AbortSignal.any([args.signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
  const result = {
    errors: [],
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

  for await (const { provider, entry, error, sourceUrl } of fairEntries(ctx, config, signal)) {
    if (error) {
      result.errors.push({ code: error }); continue;
    }
    if (!entry || !entry.name || entry.isDir) {
      result.skipped++;
      result.skippedByReason.directory++;
      continue;
    }
    if (result.uploaded >= maxFilesPerRun) {
      result.skipped++;
      result.skippedByReason.fileLimit++;
      break;
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
    if (result.uploadedBytes >= maxBytesPerRun) {
      break;
    }
    let body;
    try {
      body =
        typeof entry.openStream === "function" ?
          await entry.openStream() :
          typeof entry.download === "function" ?
            await entry.download() :
            null;
      if (!body) {
        throw new Error("Provider did not provide file bytes");
      }
    }
    catch (error) {
      if (signal.aborted) {
        throw error;
      }
      result.errors.push({ provider: provider.id, code: error.code || "DOWNLOAD_FAILED" });
      continue;
    }
    let upload;
    try {
      upload = await ctx.uploadFile({
        roomId: config.roomId,
        name,
        body,
        size: entry.size,
        signal,
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
    }
    catch (error) {
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
    if (result.uploaded >= maxFilesPerRun || result.uploadedBytes >= maxBytesPerRun) {
      break;
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
  if (["gofile.io", "www.gofile.io"].includes(host)) {
    return "gofile";
  }
  return "";
}

function providerCredentials(providerId, config) {
  if (providerId === "gofile") {
    return { apiToken: config.gofileApiToken || process.env.GOFILE_API_TOKEN || "", password: config.gofileFolderPassword || process.env.GOFILE_FOLDER_PASSWORD || "" };
  }
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
