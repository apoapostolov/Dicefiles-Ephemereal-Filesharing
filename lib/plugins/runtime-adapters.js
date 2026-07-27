"use strict";

/**
 * Production adapters wired into PluginRegistry.startAll from the HTTP worker.
 *
 * - uploadFile: room ingest via lib/upload.ingestFromBuffer (as a bot identity)
 * - megaDownloader: optional megajs-backed list/download (see mega-folder/downloader.js)
 */

const { createMegaDownloader } = require("./mega-folder/downloader");

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

    let body = spec.body;
    if (body && !Buffer.isBuffer(body) && typeof body.on === "function") {
      body = await streamToBuffer(body);
    }
    if (!Buffer.isBuffer(body)) {
      throw new Error("uploadFile: body must be a Buffer (or stream)");
    }

    const getRoom =
      d.getRoom ||
      (async (id) => {
        const { Room } = require("../room");
        return Room.get(id);
      });
    const ingest =
      d.ingestFromBuffer ||
      ((opts) => require("../upload").ingestFromBuffer(opts));

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
      spec.role === "system" || spec.role === "white"
        ? spec.role
        : d.botRole || "bot";

    const extraMeta = Object.assign(
      {
        bot: role === "bot",
        botName,
        plugin: (spec.meta && spec.meta.plugin) || d.pluginId || "",
      },
      spec.meta && typeof spec.meta === "object" ? spec.meta : {},
    );

    const upload = await ingest({
      name,
      roomid: roomId,
      buffer: body,
      ip: "127.0.0.1",
      user: botName,
      account: "",
      role,
      ttl: room.fileTTL,
      meta: extraMeta,
    });
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
    stream.on("data", (c) =>
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
 *   megaDownloader?: object,
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
  const uploadFile = createUploadFileAdapter({
    getRoom: o.getRoom,
    ingestFromBuffer: o.ingestFromBuffer,
    systemUser: o.systemUser,
    botName: o.botName || o.systemUser || "Plugin Bot",
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
    uploadFile,
    botName: o.botName || "Plugin Bot",
  };
}

module.exports = {
  createUploadFileAdapter,
  createMegaDownloader,
  buildPluginRuntimeCtx,
  streamToBuffer,
};
