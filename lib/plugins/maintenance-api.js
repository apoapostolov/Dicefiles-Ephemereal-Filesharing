"use strict";

const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { revision, conflict } = require("./workflow-api");

function createMaintenanceApi({ roomFor, fileMap, assertLocal, audit }) {
  const backupRead = async (action, signal) => {
    try {
      return await action();
    }
    catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message = /^(The backup|A backup|Backup sample|Temporary backup)/.test(error.message || "") ? error.message : "Backup verification could not read the approved directory or manifest. Ask the operator to check the connection paths, permissions and JSON format.";
      throw Object.assign(new Error(message), { retryable: false });
    }
  };
  const localFile = async spec => {
    const room = await roomFor(spec); const file = await fileMap().getFresh(spec.key); assertLocal(file, room);
    if (spec.expectedRevision && revision(file.toClientJSON()) !== spec.expectedRevision) {
      throw conflict();
    }
    return { room, file };
  };
  return {
    async inspectFile(spec) {
      const { file } = await localFile(spec);
      const supported = ["image", "audio", "video", "pdf", "epub", "mobi", "comic"].includes(file.type) || /\.(pdf|epub|mobi|azw3?|cbz|cbr|cbt)$/i.test(file.name);
      try {
        const stat = await fs.promises.lstat(file.storage.full);
        return { key: file.key, exists: stat.isFile() && !stat.isSymbolicLink(), bytes: stat.size, preview: { supported, state: file.storage.assets?.size ? "ready" : supported ? "missing" : "unsupported" } };
      }
      catch (error) {
        if (error.code !== "ENOENT") {
          throw new Error("Stored file could not be inspected. Ask the operator to check storage access.");
        } return { key: file.key, exists: false, bytes: 0, preview: { supported, state: "missing-blob" } };
      }
    },
    async retryFilePreview(spec) {
      const { room, file } = await localFile(spec);
      await require("../previewretry").scheduleRetry(file.hash); await audit(room, spec, "preview.retry", file.key);
      return { queued: true, detail: "Preview retry queued with the existing worker and its retry limits." };
    },
    async verifyFile(spec) {
      const { file } = await localFile(spec); const maxBytes = Math.max(1, Math.min(1073741824, Number(spec.maxBytes) || 33554432));
      let handle;
      try {
        handle = await fs.promises.open(file.storage.full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return { state: "not-file", bytes: 0 };
        }
        if (stat.size > maxBytes) {
          return { state: "over-budget", bytes: 0, size: stat.size };
        }
        const digest = createHash("blake2b512"); let bytes = 0;
        const stream = handle.createReadStream({ autoClose: false, highWaterMark: 65536 });
        try {
          for await (const chunk of stream) {
            spec.signal?.throwIfAborted(); bytes += chunk.length;
            if (bytes > maxBytes) {
              return { state: "over-budget", bytes };
            }
            digest.update(chunk);
            await delay(Math.ceil(chunk.length / (8 * 1024 * 1024) * 1000), undefined, { signal: spec.signal });
          }
        }
        finally {
          stream.destroy();
        }
        const actual = digest.digest().subarray(0, 30).toString("base64");
        return { state: actual === file.hash && bytes === file.size ? "verified" : "mismatch", bytes };
      }
      catch (error) {
        if (spec.signal?.aborted) {
          throw error;
        }
        return { state: error.code === "ENOENT" ? "missing" : "unreadable", bytes: 0 };
      }
      finally {
        await handle?.close();
      }
    },
    async getStorageMetrics(spec) {
      await roomFor(spec);
      const connection = require("./connections").createPluginConnections()({ roomId: spec.roomId, pluginId: spec.pluginId }).resolve(spec.connectionId, "maintenance");

      if (!connection.settings.capabilities?.includes("storage:read")) {
        throw Object.assign(new Error("Storage metrics need an operator connection granting storage:read to this room and bot."), { status: 403 });
      }
      return (await require("../storage-volumes").storageSnapshot()).map(({ id, total, used, free, usedPercent, ok }) => ({ id, total, used, free, usedPercent, ok }));
    },
    async probeLink(spec) {
      const room = await roomFor(spec); const link = (await require("../links").EMITTER.for(room)).find(link => link.id === spec.id);
      if (!link) {
        throw Object.assign(new Error("The collected link is unavailable. Refresh the report."), { status: 404 });
      }
      if (!/^https?:/i.test(link.url)) {
        return { state: "unsupported", status: 0 };
      }
      try {
        const { guardedStream } = require("../net-guard");

        let response = await guardedStream(link.url, { method: "HEAD", signal: spec.signal }, { maxBytes: 1024, timeoutMs: 10000, maxRedirects: 3, signal: spec.signal });
        response.body.on("error", () => {}); response.body.destroy();
        if (response.status === 405 || response.status === 501) {
          response = await guardedStream(link.url, { headers: { range: "bytes=0-1023" }, signal: spec.signal }, { maxBytes: 1024, timeoutMs: 10000, maxRedirects: 3, signal: spec.signal });
          response.body.on("error", () => {}); response.body.destroy();
        }
        const retry = response.headers["retry-after"];
        return { status: response.status, state: response.status === 429 ? "rate-limited" : [404, 410].includes(response.status) ? "broken" : [401, 403].includes(response.status) ? "restricted" : response.ok ? "reachable" : "temporary",
          retryAfterMs: /^\d+$/.test(retry || "") ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now() || 0) };
      }
      catch (error) {
        if (spec.signal?.aborted) {
          throw error;
        } return { state: "unreachable", status: 0 };
      }
    },
    async inspectBackup(spec) {
      await roomFor(spec);
      const connection = require("./connections").createPluginConnections()({ roomId: spec.roomId, pluginId: spec.pluginId }).resolve(spec.connectionId, "backup");

      return backupRead(() => require("./backup-reader").inspectBackup(connection.settings), spec.signal);
    },
    async verifyBackup(spec) {
      await roomFor(spec);
      const connection = require("./connections").createPluginConnections()({ roomId: spec.roomId, pluginId: spec.pluginId }).resolve(spec.connectionId, "backup");

      return backupRead(() => require("./backup-reader").verifyBackup(connection.settings, spec), spec.signal);
    },
    async retryFileMetadata(spec) {
      const { room, file } = await localFile(spec);
      const { torrent } = file.meta || {};
      if (torrent?.files?.length) {
        await fileMap().updateAtomic(file.key, current => {
          assertLocal(current, room);
          if (spec.expectedRevision && revision(current.toClientJSON()) !== spec.expectedRevision) {
            throw conflict();
          }
          const currentCinema = current.meta.cinema || {}; const next = { ...currentCinema };
          for (const [index, entry] of torrent.files.entries()) {
            if (/\.(mp4|mkv|webm|m4v|avi|mov)$/i.test(entry.path || "") && !currentCinema[index]?.movie && currentCinema[index]?.autoMatch?.state !== "manual") {
              next[index] = { ...next[index], autoMatch: { state: "retry", nextAttemptAt: Date.now(), checkedAt: Date.now() } };
            }
          }
          return new current.constructor({ ...current.toJSON(), meta: { ...current.meta, cinema: next } });
        });
        await audit(room, spec, "metadata.retry", file.key); return { queued: true, detail: "Unmatched torrent videos returned to the existing matching queue." };
      }
      if (file.type === "video") {
        return { queued: false, detail: "Use Video Information to search and confirm this video's catalogue match." };
      }
      const extracted = await require("../meta").getMetaData(file.storage, file.name);
      spec.signal?.throwIfAborted();
      await fileMap().updateAtomic(file.key, current => {
        assertLocal(current, room);
        if (spec.expectedRevision && revision(current.toClientJSON()) !== spec.expectedRevision) {
          throw conflict();
        }
        const fill = (current, incoming) => {
          const next = { ...current }; for (const [key, value] of Object.entries(incoming || {})) {
            if (next[key] == null || next[key] === "") {
              next[key] = value;
            }
          } return next;
        };
        return new current.constructor({ ...current.toJSON(), tags: fill(current.tags, extracted.tags), meta: fill(current.meta, extracted.meta) });
      });
      await audit(room, spec, "metadata.extract", file.key); return { queued: false, detail: "Embedded metadata re-read; existing values preserved." };
    },
  };
}

module.exports = { createMaintenanceApi };
