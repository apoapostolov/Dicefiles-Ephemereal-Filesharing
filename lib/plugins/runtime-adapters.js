"use strict";

/**
 * Production adapters wired into PluginRegistry.startAll from the HTTP worker.
 *
 * - uploadFile: room ingest via lib/upload.ingestFromBuffer (as a bot identity)
 * - megaDownloader: optional megajs-backed list/download (see mega-folder/downloader.js)
 */

const { createMegaDownloader } = require("./mega-folder/downloader");
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

/**
 * Small, injectable outbound HTTP surface for first-party plugins.
 * URLs can contain bot tokens, so errors intentionally never echo the URL.
 */
function createPluginHttpClient(deps) {
  const fetchImpl = deps && deps.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("plugin HTTP client requires fetch");
  }
  return {
    async requestJson(url, options) {
      const o = options || {};
      const method = String(o.method || "GET").toUpperCase();
      const timeoutMs = clampInt(o.timeoutMs, 10000, 500, 120000);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: Object.assign(
            { accept: "application/json" },
            o.body == null ? {} : { "content-type": "application/json" },
            o.headers || {},
          ),
          body: o.body == null ? undefined : JSON.stringify(o.body),
          signal: controller.signal,
        });
      }
      catch (ex) {
        const reason =
          ex && ex.name === "AbortError" ?
            `timed out after ${timeoutMs}ms` :
            "network error";
        throw new Error(`remote service request failed: ${reason}`);
      }
      finally {
        clearTimeout(timeout);
      }

      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        }
        catch (_) {
          body = { message: text.slice(0, 1000) };
        }
      }
      if (!response.ok) {
        const detail =
          body && (body.description || body.message || body.error);
        const error = new Error(
          `remote service returned HTTP ${response.status}${
            detail ? `: ${String(detail).slice(0, 300)}` : ""}`,
        );
        error.retryable =
          response.status === 429 || response.status >= 500;
        throw error;
      }
      return {
        ok: true,
        status: response.status,
        body,
      };
    },
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
        files: files.length,
        openRequests: requests.filter(
          request => request.status === "open",
        ).length,
      };
    },

    async listFiles(spec) {
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
      return files.
        filter(file => !since || Number(file.uploaded) > since).
        sort((a, b) => Number(b.uploaded) - Number(a.uploaded)).
        slice(0, limit).
        map(file => ({
          key: file.key,
          name: file.name,
          size: file.size,
          hash: file.hash,
          type: file.type,
          uploaded: file.uploaded,
          expires: file.expires,
          href: file.href || `/g/${file.key}`,
          tags: Object.assign({}, file.tags || {}),
          meta: Object.assign({}, file.meta || {}),
        }));
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
      const limit = clampInt(spec && spec.limit, 20, 1, 100);
      const requests = await listRoomRequests(room);
      return requests.
        filter(request => !status || request.status === status).
        slice(0, limit).
        map(request => ({
          key: request.key,
          name: request.name,
          status: request.status,
          uploaded: request.uploaded,
          expires: request.expires,
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
          maxBytes: spec.maxBytes,
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
function buildPluginRuntimeCtx(opts) {
  const o = opts || {};
  const megaDownloader =
    o.megaDownloader ||
    createMegaDownloader({ requireMegajs: o.requireMegajs });
  const remoteDownloaders =
    o.remoteDownloaders ||
    new RemoteDownloaderRegistry([
      {
        id: "mega",
        name: "Mega.nz",
        canHandle(value) {
          const url = value instanceof URL ? value : new URL(String(value));
          return ["mega.nz", "mega.co.nz"].includes(
            url.hostname.toLowerCase(),
          );
        },
        listFolder: megaDownloader.listFolder.bind(megaDownloader),
      },
      createPixeldrainDownloader({ fetchImpl: o.fetchImpl }),
    ]);
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
