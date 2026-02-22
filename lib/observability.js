"use strict";

const fs = require("fs");
const path = require("path");
const BROKER = require("./broker");
const CONFIG = require("./config");

const startTime = Date.now();

const metrics = {
  uploadsCreated: 0,
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
const uploadsDir = toPath(CONFIG.get("uploads"), "uploads");

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
  const probe = path.join(
    uploadsDir || process.cwd(),
    `.health-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    await fs.promises.mkdir(path.dirname(probe), { recursive: true });
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.unlink(probe);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      path: uploadsDir,
    };
  }
  catch (ex) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      path: uploadsDir,
      error: ex.message || ex.toString(),
    };
  }
}

async function health() {
  const [redis, storage] = await Promise.all([
    checkRedis(),
    checkStorageWritable(),
  ]);
  const ok = redis.ok && storage.ok;
  return {
    ok,
    now: new Date().toISOString(),
    checks: {
      redis,
      storage,
    },
    metrics: snapshot(),
  };
}

module.exports = {
  event,
  inc,
  snapshot,
  health,
  trackUploadCreated,
  trackUploadDeleted,
  trackDownload,
  trackRequestCreated,
  trackRequestFulfilled,
  trackPreviewFailure,
};
