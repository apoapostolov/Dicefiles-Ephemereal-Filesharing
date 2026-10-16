"use strict";

/**
 * Production adapters wired into PluginRegistry.startAll from the HTTP worker.
 *
 * - uploadFile: room ingest via lib/upload.ingestFromBuffer (as a bot identity)
 * - megaDownloader: optional megajs-backed list/download (see mega-folder/downloader.js)
 */

const { createMegaDownloader } = require("./mega-folder/downloader");
const { createPlowshareDownloader } = require("./remote-import/plowshare");
const { createGofileDownloader } = require("./remote-import/gofile");
const { RemoteDownloaderRegistry } = require("./remote-downloaders");
const {
  createPixeldrainDownloader,
} = require("./remote-import/pixeldrain");
const { createDefaultEventLease } = require("./event-lease");

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function serializePluginFile(file) {
  return { key: file.key, name: file.name, size: file.size, hash: file.hash, type: file.type, uploaded: file.uploaded, expires: file.expires,
    href: file.href || `/g/${file.key}`, tags: Object.assign({}, file.tags || {}), meta: require("./metadata").publicMetadata(file.meta || {}), revision: require("./workflow-api").revision(file), assets: file.assets || [] };
}

/**
 * Small, injectable outbound HTTP surface for first-party plugins.
 * URLs can contain bot tokens, so errors intentionally never echo the URL.
 */
function createPluginHttpClient(deps) {
  const fetchImpl = deps && deps.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("plugin HTTP client requires fetch");
  }

  async function request(url, options, format = "json") {
    const o = options || {};
    const method = String(o.method || "GET").toUpperCase();
    const timeoutMs = clampInt(o.timeoutMs, 10000, 500, 120000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: Object.assign(
          { accept: "application/json" },
          o.body == null ? {} : { "content-type": "application/json" },
          o.headers || {},
        ),
        body: o.body == null ? undefined : JSON.stringify(o.body),
        signal: o.signal ? AbortSignal.any([controller.signal, o.signal]) : controller.signal,
        redirect: "error",
      });
      const maxBytes = clampInt(o.maxResponseBytes, 1024 * 1024, 1024, 8 * 1024 * 1024);
      let buffer;
      if (response.body && response.body[Symbol.asyncIterator]) {
        const chunks = []; let bytes = 0;
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk); bytes += buffer.length;
          if (bytes > maxBytes) {
            controller.abort();
            throw Object.assign(new Error("Remote service response is too large. Reduce the requested page size."), { code: "RESPONSE_TOO_LARGE", retryable: false });
          }
          chunks.push(buffer);
        }
        buffer = Buffer.concat(chunks);
      }
      else {
        buffer = typeof response.arrayBuffer === "function" ? Buffer.from(await response.arrayBuffer()) : Buffer.from(await response.text());
        if (buffer.length > maxBytes) {
          throw Object.assign(new Error("Remote service response is too large. Reduce the requested page size."), { code: "RESPONSE_TOO_LARGE", retryable: false });
        }
      }
      if (response.ok && format !== "json") {
        return { ok: true, status: response.status, body: format === "buffer" ? buffer : buffer.toString("utf8"), headers: response.headers };
      }
      const text = buffer.toString("utf8");
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        }
        catch (_) {
          if (response.ok) {
            throw Object.assign(new Error("Remote service returned invalid JSON. Check the service configuration and try again."), { code: "INVALID_RESPONSE", retryable: false });
          }
        }
      }
      if (!response.ok) {
        const hints = { 401: "Check the bot credentials.", 403: "Check the bot permissions and destination.", 404: "Check the configured destination.", 429: "The service is rate limiting requests. Retry later." };
        const error = Object.assign(new Error(`Remote service returned HTTP ${response.status}. ${hints[response.status] || "Retry later or check the service status."}`), {
          code: "REMOTE_HTTP_ERROR", status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        });
        const header = response.headers?.get("retry-after");
        error.retryAfterMs = Math.max(0, /^\d+(?:\.\d+)?$/.test(header || "") ? Number(header) * 1000 : Date.parse(header) - Date.now() || 0, Number(body?.parameters?.retry_after ?? body?.retry_after) * 1000 || 0);
        throw error;
      }
      return { ok: true, status: response.status, body, headers: response.headers };
    }
    catch (ex) {
      if (ex?.code && ["REMOTE_HTTP_ERROR", "RESPONSE_TOO_LARGE", "INVALID_RESPONSE"].includes(ex.code)) {
        throw ex;
      }
      const reason =
        ex && ex.name === "AbortError" ?
          `timed out after ${timeoutMs}ms` :
          "network error";
      throw Object.assign(new Error(`Remote service request failed: ${reason}. Retry later and check the network connection.`), { code: "REMOTE_NETWORK_ERROR", retryable: !o.signal?.aborted });
    }
    finally {
      clearTimeout(timeout);
    }
  }

  return {
    requestJson: (url, options) => request(url, options),
    requestText: (url, options) => request(url, options, "text"),
    requestBuffer: (url, options) => request(url, options, "buffer"),
  };
}

/**
 * Stable read/action surface for trusted in-process bots.
 * Keeps plugins out of Room/Broker internals and is injectable in tests.
 */
function createDicefilesPluginApi(deps) {
  const d = deps || {};
  const getRoom =
    d.getRoom ||
    (async roomId => {
      const { Room } = require("../room");

      return Room.get(roomId);
    });
  const listRoomRequests =
    d.listRoomRequests ||
    (room => require("../request").EMITTER.for(room));
  const createRoomRequest =
    d.createRoomRequest ||
    ((...args) => require("../request").EMITTER.createRequest(...args));

  return {
    apiVersion: 2,
    ...require("./workflow-api").createWorkflowApi({ getRoom }),
    async listLinks(spec) {
      const room = await getRoom(spec?.roomId);
      if (!room) {
        throw Object.assign(new Error("Room is unavailable. Check the bot invitation."), { status: 404 });
      }
      const links = await (d.listRoomLinks || (room => require("../links").EMITTER.for(room)))(room);
      return links.slice(0, clampInt(spec?.limit, 100, 1, 500)).map(link => ({ id: link.id, name: link.name, url: link.url, date: link.date, expires: link.expires, meta: require("./metadata").publicMetadata(link.meta) }));
    },
    async addLink(spec) {
      const room = await getRoom(spec?.roomId);
      if (!room) {
        throw Object.assign(new Error("Room is unavailable. Check the bot invitation."), { status: 404 });
      }
      if ((room.config?.get("linkCollection") ?? require("../config").get("linkCollection")) === false) {
        throw Object.assign(new Error("Link collection is disabled. Enable it in Room Options before collecting feed links."), { retryable: false });
      }
      const url = new URL(String(spec.url || ""));
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
        throw Object.assign(new Error("Collected links must be complete HTTP or HTTPS addresses without embedded credentials."), { retryable: false });
      }
      url.hash = "";
      const { sourceFingerprint } = require("./metadata");

      const identity = sourceFingerprint(`${spec.pluginId}\0${spec.sourceId || url.href}`);
      const links = await (d.listRoomLinks || (room => require("../links").EMITTER.for(room)))(room);
      const previous = links.find(link => link.meta?.pluginSource?.identity === identity || link.url === url.href);
      if (previous) {
        return { id: previous.id, added: false };
      }
      const link = await (d.createLink || ((input, ttl) => require("../links").Link.create(input, ttl)))({
        roomid: spec.roomId, url: url.href, name: String(spec.title || url.hostname).slice(0, 200), sharer: spec.botName || "Collector",
        meta: { bot: true, plugin: spec.pluginId, pluginSource: { identity, provider: String(spec.provider || "feed").slice(0, 40), revision: sourceFingerprint(spec.revision || "") } },
      }, Math.max(1, Math.min(8760, Number(room.fileTTL) || 24)));
      return { id: link.id, added: true };
    },
    async getEventItem(spec) {
      const room = await getRoom(String(spec?.roomId || ""));
      if (!room) {
        return null;
      }
      const request = String(spec?.event || "").startsWith("request_");
      const entries = request ? await listRoomRequests(room) : await room.files.for("mod", "127.0.0.1");
      const item = entries.find(entry => entry.key === spec.key && !entry.expired && Number(entry.expires || Infinity) > Date.now());
      if (!item) {
        return null;
      }
      return { roomid: room.roomid, key: item.key, name: item.name, size: item.size, type: item.type, uploaded: item.uploaded,
        href: request ? `/q/${item.key}` : item.href || `/g/${item.key}`, meta: { bot: item.meta?.bot === true } };
    },
    async getFile(spec) {
      if (typeof spec?.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(spec.key)) {
        throw new Error("Choose a valid file key from listFilesPage.");
      }
      // Resolve within the room's full inventory rather than trusting global IDs.
      if (!spec.roomId) {
        throw new Error("Choose a room before reading a file.");
      }
      const room = await getRoom(spec.roomId);
      if (!room) {
        throw Object.assign(new Error("Room is unavailable. Check the bot invitation."), { status: 404 });
      }
      const file = (await room.files.for("mod", "127.0.0.1")).find(file => !file.meta?.request && file.key === spec.key);
      if (!file) {
        throw Object.assign(new Error("File is unavailable in this room. Refresh the file list."), { status: 404 });
      }
      return serializePluginFile(file);
    },
    async getRoomInventory(spec) {
      const roomId = String(spec?.roomId || "").trim();
      if (!roomId) {
        throw new Error("Choose a room before reading its inventory.");
      }
      const room = await getRoom(roomId);
      if (!room) {
        throw Object.assign(new Error("Room is unavailable. Check the bot invitation."), { status: 404 });
      }
      const files = (await room.files.for("mod", "127.0.0.1")).filter(file => !file.meta?.request);
      const types = Object.create(null); const hashes = new Map();
      let bytes = 0; let expiring = 0;
      const time = Date.now();
      for (const file of files) {
        const size = Math.max(0, Number(file.size) || 0); bytes += size;
        const type = String(file.type || "file"); types[type] ||= { files: 0, bytes: 0 }; types[type].files++; types[type].bytes += size;
        if (Number(file.expires) > time && Number(file.expires) <= time + 86400000) {
          expiring++;
        }
        if (file.hash) {
          hashes.set(file.hash, (hashes.get(file.hash) || 0) + 1);
        }
      }
      const duplicates = [...hashes.values()].filter(count => count > 1);
      return { roomId, files: files.length, bytes, byType: types, expiringWithin24Hours: expiring, duplicateGroups: duplicates.length, duplicateCopies: duplicates.reduce((total, count) => total + count - 1, 0), measuredAt: time };
    },
    async getRoomSummary(roomId) {
      const id = String(roomId || "").trim();
      if (!id) {
        throw new Error("roomId required");
      }
      const room = await getRoom(id);
      if (!room) {
        throw new Error(`room not found: ${id}`);
      }
      const {config} = room;
      const files = await room.files.for("mod", "127.0.0.1");
      const requests = await listRoomRequests(room);
      return {
        roomId: id,
        name:
          config && typeof config.get === "function" ?
            config.get("roomname") || id :
            room.name || id,
        href: `/r/${encodeURIComponent(id)}`,
        fileTTL: Number(room.fileTTL) || null,
        files: files.filter(file => !file.meta?.request).length,
        openRequests: requests.filter(
          request => request.status === "open",
        ).length,
      };
    },

    async listFiles(spec) {
      return (await this.listFilesPage(spec)).files;
    },

    async listFilesPage(spec) {
      const roomId = String(spec && spec.roomId || "").trim();
      if (!roomId) {
        throw new Error("roomId required");
      }
      const room = await getRoom(roomId);
      if (!room) {
        throw new Error(`room not found: ${roomId}`);
      }
      const files = await room.files.for("mod", "127.0.0.1");
      const since = Number(spec && spec.since) || 0;
      const limit = clampInt(spec && spec.limit, 100, 1, 500);
      const query = String(spec?.query || "").trim().toLocaleLowerCase();
      const expiresBefore = Number(spec?.expiresBefore) || 0;
      let cursor;
      if (spec?.cursor) {
        try {
          if (typeof spec.cursor !== "string" || spec.cursor.length > 2048) {
            throw new Error();
          }
          cursor = JSON.parse(Buffer.from(String(spec.cursor), "base64url").toString("utf8"));
          if (!Number.isFinite(cursor.uploaded) || typeof cursor.key !== "string" || cursor.key.length > 256) {
            throw new Error();
          }
        }
        catch (_) {
          throw new Error("File cursor is invalid. Restart listing from the first page.");
        }
      }
      const ordered = files.
        filter(file => !file.meta?.request && (!since || Number(file.uploaded) > since) && (!query || String(file.name).toLocaleLowerCase().includes(query)) && (!expiresBefore || Number(file.expires) > Date.now() && Number(file.expires) <= expiresBefore)).
        sort((a, b) => Number(b.uploaded) - Number(a.uploaded) || String(a.key).localeCompare(String(b.key))).
        filter(file => !cursor || Number(file.uploaded) < cursor.uploaded || Number(file.uploaded) === cursor.uploaded && String(file.key).localeCompare(cursor.key) > 0);
      const selected = ordered.slice(0, limit);
      const last = selected[selected.length - 1];
      return { files: selected.map(serializePluginFile), nextCursor: ordered.length > limit ? Buffer.from(JSON.stringify({ uploaded: Number(last.uploaded), key: last.key })).toString("base64url") : null };
    },

    async postMessage(spec) {
      const roomId = String(spec && spec.roomId || "").trim();
      const text = String(spec && spec.text || "").trim();
      if (!roomId || !text) {
        throw new Error("roomId and text required");
      }
      if (text.length > 2000) {
        throw new Error("plugin message must be at most 2000 characters");
      }
      const room = await getRoom(roomId);
      if (!room) {
        throw new Error(`room not found: ${roomId}`);
      }
      const { toMessage } = require("../util");
      const BROKER = require("../broker");

      const botName =
        String(spec.botName || d.botName || "Plugin Bot").trim().slice(0, 80);
      BROKER.emit(`${roomId}:message`, {
        notify: true,
        user: botName,
        role: "bot",
        msg: await toMessage(text),
        meta: {
          bot: true,
          botName,
          plugin: String(spec.pluginId || d.pluginId || ""),
        },
      });
      return { ok: true, roomId };
    },

    async listRequests(spec) {
      const roomId = String(spec && spec.roomId || "").trim();
      if (!roomId) {
        throw new Error("roomId required");
      }
      const room = await getRoom(roomId);
      if (!room) {
        throw new Error(`room not found: ${roomId}`);
      }
      const status = String(spec && spec.status || "").trim();
      if (status && !["open", "fulfilled"].includes(status)) {
        throw new Error("Request status must be open or fulfilled.");
      }
      const limit = clampInt(spec && spec.limit, 20, 1, 100);
      const requests = await listRoomRequests(room);
      return requests.
        filter(request => !status || request.status === status).
        sort((a, b) => Number(b.uploaded) - Number(a.uploaded)).
        slice(0, limit).
        map(request => ({
          key: request.key,
          name: request.name,
          status: request.status,
          uploaded: request.uploaded,
          expires: request.expires,
          claimedBy: request.claimedBy || "",
          claimedUntil: request.claimedUntil || 0,
          fulfilledAt: request.fulfilledAt || 0,
          revision: require("./workflow-api").revision(request.toClientJSON ? request.toClientJSON() : request),
        }));
    },

    async createRequest(spec) {
      const roomId = String(spec && spec.roomId || "").trim();
      const text = String(spec && spec.text || "").trim();
      if (!roomId || !text) {
        throw new Error("roomId and text required");
      }
      if (text.length > 200) {
        throw new Error("plugin request must be at most 200 characters");
      }
      const room = await getRoom(roomId);
      if (!room) {
        throw new Error(`room not found: ${roomId}`);
      }
      if (room.config?.get("allowRequests") === false) {
        throw new Error("Requests are disabled for this room. Ask a room owner to enable Allow requests.");
      }
      const botName =
        String(spec.botName || d.botName || "Plugin Bot").trim().slice(0, 80);
      const request = await createRoomRequest(
        roomId,
        text,
        "",
        "127.0.0.1",
        botName,
        "bot",
        "",
        room.fileTTL,
        "",
        {
          plugin: String(spec.pluginId || d.pluginId || ""),
          remoteUser: String(spec.remoteUser || "").slice(0, 80),
        },
      );
      return request.toClientJSON();
    },
  };
}

/**
 * Build uploadFile(ctx-style) using Room + ingestFromBuffer.
 * Injectable deps keep unit tests free of Redis/disk.
 *
 * Uploads are attributed to a **bot** by default (role=bot, cyan BOT pill in UI)
 * so plugins look like automation bots, not system noise or human accounts.
 *
 * @param {{
 *   getRoom?: (roomId: string) => Promise<object|null>,
 *   ingestFromBuffer?: Function,
 *   systemUser?: string,
 *   botName?: string,
 *   botRole?: string,
 * }} [deps]
 * @returns {(spec: object) => Promise<{key: string, href?: string}>}
 */
function createUploadFileAdapter(deps) {
  const d = deps || {};
  return async function uploadFile(spec) {
    if (!spec || typeof spec !== "object") {
      throw new Error("uploadFile: spec required");
    }
    const roomId = String(spec.roomId || "").trim();
    const name = String(spec.name || "").trim();
    if (!roomId || roomId.length < 4) {
      throw new Error("uploadFile: roomId required");
    }
    if (!name) {
      throw new Error("uploadFile: name required");
    }

    let {body} = spec;
    const isStream = body && typeof body.pipe === "function";
    if (body instanceof Uint8Array && !Buffer.isBuffer(body)) {
      body = Buffer.from(body);
    }
    if (!Buffer.isBuffer(body) && !isStream) {
      throw new Error("uploadFile: body must be a Buffer (or stream)");
    }
    const maxBytes = clampInt(spec.maxBytes, 256 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER);
    spec.signal?.throwIfAborted();
    if (Buffer.isBuffer(body) && body.byteLength > maxBytes) {
      throw Object.assign(new Error("Imported file exceeds its size limit. Increase the bot's file limit or select a smaller file."), { code: "PLUGIN_UPLOAD_TOO_LARGE" });
    }

    const getRoom =
      d.getRoom ||
      (async id => {
        const { Room } = require("../room");

        return Room.get(id);
      });
    const ingestBuffer =
      d.ingestFromBuffer ||
      (opts => require("../upload").ingestFromBuffer(opts));
    const ingestStream =
      d.ingestFromStream ||
      (opts => require("../upload").ingestFromStream(opts));

    const room = await getRoom(roomId);
    if (!room) {
      throw new Error(`uploadFile: room not found: ${roomId}`);
    }

    const botName =
      (spec.botName && String(spec.botName).trim()) ||
      (d.botName && String(d.botName).trim()) ||
      d.systemUser ||
      "Plugin Bot";
    const role =
      spec.role === "system" || spec.role === "white" ?
        spec.role :
        d.botRole || "bot";

    const extraMeta = Object.assign(
      {
        bot: role === "bot",
        botName,
        plugin: (spec.meta && spec.meta.plugin) || d.pluginId || "",
      },
      spec.meta && typeof spec.meta === "object" ? spec.meta : {},
    );

    const common = {
      name,
      roomid: roomId,
      ip: "127.0.0.1",
      user: botName,
      account: "",
      role,
      ttl: room.fileTTL,
      meta: extraMeta,
      skipIfRoomHashExists: spec.skipIfRoomHashExists === true,
    };
    const upload = isStream ?
      await ingestStream(
        Object.assign(common, {
          stream: body,
          maxBytes,
          signal: spec.signal,
        }),
      ) :
      await ingestBuffer(Object.assign(common, { buffer: body }));
    return {
      key: upload.key,
      href: upload.href,
      name: upload.name,
      size: upload.size,
      meta: upload.meta || extraMeta,
    };
  };
}

/**
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", c =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
    );
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Default production plugin runtime context pieces.
 * @param {{
 *   log?: object,
 *   scheduleRun?: Function,
 *   getRoom?: Function,
 *   ingestFromBuffer?: Function,
 *   ingestFromStream?: Function,
 *   megaDownloader?: object,
 *   remoteDownloaders?: object,
 *   requireMegajs?: Function,
 *   botName?: string,
 *   pluginId?: string,
 * }} [opts]
 */
let defaultRemoteDownloaders;

function createRemoteDownloaderRegistry(o = {}) {
  const megaDownloader = o.megaDownloader || createMegaDownloader({ requireMegajs: o.requireMegajs });
  return new RemoteDownloaderRegistry([
    {
      id: "mega",
      name: "Mega.nz",
      contractVersion: 1,
      capabilities: ["single-file", "folder", "declared-size"],
      apiRevision: "megajs-1",
      probe: async () => ({ available: megaDownloader.sdkAvailable !== false, code: megaDownloader.sdkAvailable === false ? "SDK_UNAVAILABLE" : undefined }),
      canHandle(value) {
        const url = value instanceof URL ? value : new URL(String(value));
        return ["mega.nz", "mega.co.nz"].includes(
          url.hostname.toLowerCase(),
        );
      },
      listFolder: megaDownloader.listFolder.bind(megaDownloader),
    },
    createPixeldrainDownloader({ fetchImpl: o.fetchImpl }),
    createGofileDownloader({ fetchImpl: o.fetchImpl }),
    createPlowshareDownloader(o.plowshare || require("../config").get("remoteImport")?.plowshare || {}),
  ]);
}

function getDefaultRemoteDownloaders() {
  return defaultRemoteDownloaders ||= createRemoteDownloaderRegistry();
}

function buildPluginRuntimeCtx(opts) {
  const o = opts || {};
  const megaDownloader =
    o.megaDownloader ||
    createMegaDownloader({ requireMegajs: o.requireMegajs });
  const remoteDownloaders = o.remoteDownloaders || (o.fetchImpl || o.megaDownloader || o.requireMegajs ? createRemoteDownloaderRegistry(o) : getDefaultRemoteDownloaders());
  const uploadFile = createUploadFileAdapter({
    getRoom: o.getRoom,
    ingestFromBuffer: o.ingestFromBuffer,
    ingestFromStream: o.ingestFromStream,
    systemUser: o.systemUser,
    botName: o.botName || o.systemUser || "Plugin Bot",
    pluginId: o.pluginId,
  });
  let {publicBaseUrl} = o;
  let {retentionDays} = o;
  if (publicBaseUrl == null || retentionDays == null) {
    try {
      const CONFIG = require("../config");

      if (publicBaseUrl == null) {
        publicBaseUrl = CONFIG.get("publicBaseUrl") || "";
      }
      if (retentionDays == null) {
        retentionDays = CONFIG.get("pluginSyncLogRetentionDays");
      }
    }
    catch (_) {
      publicBaseUrl = publicBaseUrl || "";
    }
  }
  const http = o.http || createPluginHttpClient({ fetchImpl: o.fetchImpl });
  const events =
    o.events ||
    createDefaultEventLease({
      retentionDays,
      forceMemory: o.forceMemoryEventLease,
    });
  const dicefiles =
    o.dicefiles ||
    createDicefilesPluginApi({
      getRoom: o.getRoom,
      botName: o.botName,
      pluginId: o.pluginId,
    });
  return {
    log: o.log || {
      info: (...a) => console.log(...a),
      warn: (...a) => console.warn(...a),
      error: (...a) => console.error(...a),
    },
    scheduleRun: o.scheduleRun,
    megaDownloader,
    remoteDownloaders,
    uploadFile,
    botName: o.botName || "Plugin Bot",
    publicBaseUrl: publicBaseUrl || "",
    http,
    events,
    dicefiles,
    apiVersion: 2,
    createPluginState: o.createPluginState || require("./state").createPluginStateFactory({ memory: o.forceMemoryEventLease }),
    createPluginConnections: o.createPluginConnections || require("./connections").createPluginConnections(),
    createPluginJobs: o.createPluginJobs || (scope => require("./jobs").getPluginJobs().scope(scope)),
  };
}

module.exports = {
  createUploadFileAdapter,
  createPluginHttpClient,
  createDicefilesPluginApi,
  createMegaDownloader,
  buildPluginRuntimeCtx,
  streamToBuffer,
};

module.exports.getDefaultRemoteDownloaders = getDefaultRemoteDownloaders;
module.exports.createRemoteDownloaderRegistry = createRemoteDownloaderRegistry;
