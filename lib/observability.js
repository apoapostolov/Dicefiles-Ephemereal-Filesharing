"use strict";

const fs = require("fs");
const path = require("path");
const BROKER = require("./broker");
const CONFIG = require("./config");
const { storageSnapshot } = require("./storage-volumes");
const { reservationTotals } = require("./storage-reservations");

const startTime = Date.now();
const metricsStartedAt = new Date().toISOString();
const PUBLIC_METRICS_KEY = "observability:public:totals";
const PUBLIC_METRICS_STARTED_KEY = "observability:public:started";

const metrics = {
  uploadsCreated: 0,
  uploadsBytes: 0,
  uploadsDeleted: 0,
  downloadsServed: 0,
  downloadsBytes: 0,
  requestsCreated: 0,
  requestsFulfilled: 0,
  previewFailures: 0,
};

function toPath(p, fallback) {
  const raw = (p || fallback || "").toString().trim();
  if (!raw) {
    return null;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.join(process.cwd(), raw);
}

const lifecycleLog = toPath(CONFIG.get("observabilityLog"), "ops.log");
const redisPing = BROKER.getMethod("ping");
const publicRedis = BROKER.getMethods("get", "set", "hgetall", "hincrby");

publicRedis.
  set(PUBLIC_METRICS_STARTED_KEY, metricsStartedAt, "NX").
  catch(ex =>
    console.warn(
      "Failed initializing public observability totals",
      ex.message || ex,
    ),
  );

function appendLine(file, payload) {
  if (!file) {
    return;
  }
  try {
    fs.appendFile(file, `${JSON.stringify(payload)}\n`, () => {});
  }
  catch (ex) {
    console.error("Failed writing observability log", ex);
  }
}

function inc(name, delta = 1) {
  if (!Object.prototype.hasOwnProperty.call(metrics, name)) {
    return;
  }
  const n = Number(delta);
  if (!Number.isFinite(n)) {
    return;
  }
  metrics[name] += n;
  publicRedis.
    hincrby(PUBLIC_METRICS_KEY, name, Math.round(n)).
    catch(ex =>
      console.warn("Failed updating public observability total", ex.message || ex),
    );
}

function event(type, payload = {}) {
  appendLine(
    lifecycleLog,
    Object.assign(
      {
        at: new Date().toISOString(),
        type,
      },
      payload,
    ),
  );
}

function roomAndUser(src) {
  return {
    roomid: src.roomid || "",
    account: (src.meta && src.meta.account) || "",
    user: (src.tags && (src.tags.user || src.tags.usernick)) || "",
  };
}

function trackUploadCreated(upload) {
  inc("uploadsCreated", 1);
  const bytes = Number(upload && upload.size) || 0;
  if (bytes > 0) {
    inc("uploadsBytes", bytes);
  }
  event(
    "upload_created",
    Object.assign(roomAndUser(upload), {
      key: upload.key,
      name: upload.name,
      size: upload.size,
      uploaded: upload.uploaded,
      expires: upload.expires,
    }),
  );
}

function trackUploadDeleted(upload, reason = "deleted") {
  inc("uploadsDeleted", 1);
  event(
    "upload_deleted",
    Object.assign(roomAndUser(upload), {
      reason,
      key: upload.key,
      name: upload.name,
      size: upload.size,
      uploaded: upload.uploaded,
    }),
  );
}

function trackDownload(details) {
  const bytes = Number(details && details.bytes) || 0;
  inc("downloadsServed", 1);
  if (bytes > 0) {
    inc("downloadsBytes", bytes);
  }
  event("download_served", {
    key: (details && details.key) || "",
    roomid: (details && details.roomid) || "",
    name: (details && details.name) || "",
    bytes,
    statusCode: (details && details.statusCode) || 0,
    account: (details && details.account) || "",
    ip: (details && details.ip) || "",
  });
}

function trackRequestCreated(request) {
  inc("requestsCreated", 1);
  event(
    "request_created",
    Object.assign(roomAndUser(request), {
      key: request.key,
      text: request.name,
      uploaded: request.uploaded,
      expires: request.expires,
    }),
  );
}

function trackRequestFulfilled(request) {
  inc("requestsFulfilled", 1);
  event(
    "request_fulfilled",
    Object.assign(roomAndUser(request), {
      key: request.key,
      text: request.name,
      uploaded: request.uploaded,
    }),
  );
}

function trackPreviewFailure(storage, stage, err) {
  inc("previewFailures", 1);
  notePreviewQueueFailure();
  event("preview_failed", {
    key: (storage && storage.key) || "",
    hash: (storage && storage.hash) || "",
    file: (storage && storage.full) || "",
    stage: stage || "",
    error: err && (err.message || err.toString()),
  });
}

function snapshot() {
  return Object.assign({}, metrics, {
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
  });
}

async function persistentSnapshot() {
  const [stored, startedAt] = await Promise.all([
    publicRedis.hgetall(PUBLIC_METRICS_KEY),
    publicRedis.get(PUBLIC_METRICS_STARTED_KEY),
  ]);
  const totals = {};
  for (const name of Object.keys(metrics)) {
    const value = Number(stored && stored[name]);
    totals[name] = Number.isFinite(value) ? value : 0;
  }
  return {
    startedAt: startedAt || metricsStartedAt,
    totals,
  };
}

async function checkRedis() {
  const started = Date.now();
  try {
    const pong = await Promise.race([
      redisPing(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 1500),
      ),
    ]);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      detail: pong || "PONG",
    };
  }
  catch (ex) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: ex.message || ex.toString(),
    };
  }
}

async function checkStorageWritable() {
  const started = Date.now();
  const writable = storageSnapshot().filter(
    volume => volume.enabled && !volume.readOnly,
  );
  const volumes = await Promise.all(writable.map(async volume => {
    const probe = path.join(
      volume.path,
      `.health-${process.pid}-${Date.now()}-${Math.random().
        toString(36).
        slice(2)}`,
    );
    try {
      await fs.promises.mkdir(path.dirname(probe), { recursive: true });
      await fs.promises.writeFile(probe, "ok");
      await fs.promises.unlink(probe);
      return { id: volume.id, ok: true };
    }
    catch (ex) {
      return {
        id: volume.id,
        ok: false,
        error: ex.message || ex.toString(),
      };
    }
  }));
  return {
    ok: volumes.length > 0 && volumes.some(volume => volume.ok),
    latencyMs: Date.now() - started,
    volumes,
  };
}

/** Preview / media queue depth signal (best-effort, in-process). */
const previewQueue = {
  pending: 0,
  active: 0,
  lastFailureAt: null,
};

function setPreviewQueue(partial) {
  if (!partial || typeof partial !== "object") {
    return;
  }
  if (partial.pending != null) {
    previewQueue.pending = Math.max(0, Number(partial.pending) || 0);
  }
  if (partial.active != null) {
    previewQueue.active = Math.max(0, Number(partial.active) || 0);
  }
  if (partial.lastFailureAt) {
    previewQueue.lastFailureAt = partial.lastFailureAt;
  }
}

function notePreviewQueueFailure() {
  previewQueue.lastFailureAt = new Date().toISOString();
}

async function checkDiskFree() {
  const started = Date.now();
  const reserved = await reservationTotals().catch(() => ({}));
  const volumes = storageSnapshot(reserved).map(volume => {
    const output = Object.assign({}, volume);
    delete output.path;
    return output;
  });
  const healthy = volumes.filter(volume => volume.ok);
  return {
    ok: healthy.length > 0,
    latencyMs: Date.now() - started,
    freeBytes: healthy.reduce((sum, volume) => sum + volume.free, 0),
    totalBytes: healthy.reduce((sum, volume) => sum + volume.total, 0),
    volumes,
  };
}

async function health() {
  const [redis, storage, disk] = await Promise.all([
    checkRedis(),
    checkStorageWritable(),
    checkDiskFree(),
  ]);
  const ok = redis.ok && storage.ok;
  return {
    ok,
    now: new Date().toISOString(),
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
    checks: {
      redis,
      storage,
      disk,
      previewQueue: {
        ok: true,
        pending: previewQueue.pending,
        active: previewQueue.active,
        lastFailureAt: previewQueue.lastFailureAt,
      },
    },
    metrics: snapshot(),
  };
}

module.exports = {
  event,
  inc,
  snapshot,
  persistentSnapshot,
  health,
  setPreviewQueue,
  notePreviewQueueFailure,
  trackUploadCreated,
  trackUploadDeleted,
  trackDownload,
  trackRequestCreated,
  trackRequestFulfilled,
  trackPreviewFailure,
};
