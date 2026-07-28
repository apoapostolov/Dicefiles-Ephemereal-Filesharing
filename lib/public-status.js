"use strict";

const BROKER = require("./broker");
const OBS = require("./observability");
const CONFIG = require("./config");
const pkg = require("../package.json");

const HISTORY_KEY = "observability:public:history:v1";
const SAMPLE_LOCK_KEY = "observability:public:history-lock:v1";
const SAMPLE_INTERVAL_SEC = 5 * 60;
const HISTORY_POINTS = 288;
const CACHE_MS = 15 * 1000;
const REQUEST_WINDOW_SEC = 24 * 60 * 60;
const REQUEST_BUCKETS = 24;

const redis = BROKER.getMethods(
  "keys",
  "set",
  "zadd",
  "zrevrange",
  "zremrangebyrank",
);

let cached = null;
let inFlight = null;

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function component(id, label, check) {
  return {
    id,
    label,
    status: check && check.ok ? "operational" : "outage",
    latencyMs: finiteOrNull(check && check.latencyMs),
  };
}

function sanitizeHealth(health) {
  const checks = (health && health.checks) || {};
  const components = [
    component("database", "Realtime database", checks.redis),
    component("storage", "Upload storage", checks.storage),
    component("capacity", "Drive capacity", checks.disk),
  ];
  const hasOutage = components.
    slice(0, 2).
    some(item => item.status === "outage");
  const hasDegraded = components.some(item => item.status === "outage");
  return {
    status: hasOutage ? "outage" : hasDegraded ? "degraded" : "operational",
    components,
    previewQueue: {
      status: checks.previewQueue && checks.previewQueue.ok ?
        "operational" :
        "degraded",
      pending: finiteOrNull(checks.previewQueue && checks.previewQueue.pending) || 0,
      active: finiteOrNull(checks.previewQueue && checks.previewQueue.active) || 0,
      lastFailureAt:
        checks.previewQueue && checks.previewQueue.lastFailureAt ?
          String(checks.previewQueue.lastFailureAt) :
          null,
    },
  };
}

function summarizeUploads(uploads) {
  const current = Array.from(uploads || []).filter(
    upload => upload && !upload.expired,
  );
  return {
    files: current.length,
    logicalBytes: current.reduce(
      (total, upload) => total + (finiteOrNull(upload.size) || 0),
      0,
    ),
  };
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ?
    sorted[middle] :
    (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeRequests(
    requests,
    nowValue = Date.now(),
    bucketCount = REQUEST_BUCKETS,
    windowSec = REQUEST_WINDOW_SEC,
) {
  const now = nowValue instanceof Date ?
    nowValue.getTime() :
    Number(nowValue);
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const safeBucketCount = Math.max(1, Math.floor(Number(bucketCount) || 1));
  const safeWindowSec = Math.max(
    safeBucketCount,
    Math.floor(Number(windowSec) || REQUEST_WINDOW_SEC),
  );
  const windowMs = safeWindowSec * 1000;
  const start = safeNow - windowMs;
  const bucketMs = windowMs / safeBucketCount;
  const points = Array.from({ length: safeBucketCount }, (_, index) => ({
    at: new Date(start + index * bucketMs).toISOString(),
    opened: 0,
    fulfilled: 0,
  }));
  const current = Array.from(requests || []).filter(request => {
    if (!request) {
      return false;
    }
    const expires = Number(request.expires);
    return !Number.isFinite(expires) || expires > safeNow;
  });

  let open = 0;
  let fulfilled = 0;
  let activeClaims = 0;
  let oldestOpenSec = null;
  const fulfillmentDurations = [];

  function record(atValue, field) {
    const at = Number(atValue);
    if (!Number.isFinite(at) || at < start || at > safeNow) {
      return;
    }
    const index = Math.min(
      safeBucketCount - 1,
      Math.max(0, Math.floor((at - start) / bucketMs)),
    );
    points[index][field]++;
  }

  for (const request of current) {
    const uploaded = Number(request.uploaded);
    const fulfilledAt = Number(request.fulfilledAt);
    record(uploaded, "opened");
    if (request.status === "fulfilled") {
      fulfilled++;
      record(fulfilledAt, "fulfilled");
      if (
        Number.isFinite(uploaded) &&
        Number.isFinite(fulfilledAt) &&
        fulfilledAt >= uploaded
      ) {
        fulfillmentDurations.push((fulfilledAt - uploaded) / 1000);
      }
    }
    else {
      open++;
      if (Number(request.claimedUntil) > safeNow) {
        activeClaims++;
      }
      if (Number.isFinite(uploaded) && uploaded <= safeNow) {
        const age = Math.floor((safeNow - uploaded) / 1000);
        oldestOpenSec = oldestOpenSec == null ?
          age :
          Math.max(oldestOpenSec, age);
      }
    }
  }

  const total = open + fulfilled;
  return {
    current: {
      total,
      open,
      fulfilled,
      activeClaims,
      fulfillmentPercent: total ?
        Math.round((fulfilled / total) * 1000) / 10 :
        null,
      medianFulfillmentSec: fulfillmentDurations.length ?
        Math.round(median(fulfillmentDurations)) :
        null,
      oldestOpenSec,
    },
    last24h: {
      opened: points.reduce((sum, point) => sum + point.opened, 0),
      fulfilled: points.reduce((sum, point) => sum + point.fulfilled, 0),
    },
    timeline: {
      intervalSec: Math.round(bucketMs / 1000),
      windowSec: safeWindowSec,
      points,
    },
  };
}

function buildInsights({ totals, uploads, rooms }) {
  const downloadsServed = finiteOrNull(totals.downloadsServed) || 0;
  const downloadsBytes = finiteOrNull(totals.downloadsBytes) || 0;
  const uploadsCreated = finiteOrNull(totals.uploadsCreated) || 0;
  const files = finiteOrNull(uploads.files) || 0;
  const roomCount = finiteOrNull(rooms) || 0;
  return {
    averageDownloadBytes: downloadsServed ?
      Math.round(downloadsBytes / downloadsServed) :
      0,
    downloadsPerUpload: uploadsCreated ?
      Math.round((downloadsServed / uploadsCreated) * 10) / 10 :
      0,
    filesPerRoom: roomCount ?
      Math.round((files / roomCount) * 10) / 10 :
      0,
    previewFailures: finiteOrNull(totals.previewFailures) || 0,
  };
}

function buildSnapshot({
  now = new Date(),
  health,
  rooms = [],
  uploads = [],
  requests = [],
  registeredUsers = 0,
  persisted = { startedAt: null, totals: {} },
}) {
  const safeHealth = sanitizeHealth(health);
  const disk = (health && health.checks && health.checks.disk) || {};
  const totalBytes = finiteOrNull(disk.totalBytes);
  const freeBytes = finiteOrNull(disk.freeBytes);
  const usedBytes =
    totalBytes != null && freeBytes != null ?
      Math.max(0, totalBytes - freeBytes) :
      null;
  const usedPercent =
    totalBytes > 0 && usedBytes != null ?
      clampPercent((usedBytes / totalBytes) * 100) :
      null;
  const uploadSummary = summarizeUploads(uploads);
  const usersOnline = rooms.reduce(
    (total, room) => total + (finiteOrNull(room && room.users) || 0),
    0,
  );
  const totals = persisted.totals || {};
  const requestSummary = summarizeRequests(requests, now);

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    service: {
      name: String(CONFIG.get("name") || "Dicefiles"),
      release: String(pkg.version || ""),
      status: safeHealth.status,
      uptimeSec: finiteOrNull(health && health.uptimeSec) || 0,
    },
    capacity: {
      disk: {
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent,
      },
      uploads: uploadSummary,
    },
    community: {
      rooms: rooms.length,
      usersOnline,
      registeredUsers: finiteOrNull(registeredUsers) || 0,
    },
    activity: {
      since: persisted.startedAt || now.toISOString(),
      totals: {
        uploadsCreated: finiteOrNull(totals.uploadsCreated) || 0,
        uploadsDeleted: finiteOrNull(totals.uploadsDeleted) || 0,
        downloadsServed: finiteOrNull(totals.downloadsServed) || 0,
        downloadsBytes: finiteOrNull(totals.downloadsBytes) || 0,
        requestsCreated: finiteOrNull(totals.requestsCreated) || 0,
        requestsFulfilled: finiteOrNull(totals.requestsFulfilled) || 0,
        previewFailures: finiteOrNull(totals.previewFailures) || 0,
      },
    },
    requests: requestSummary,
    insights: buildInsights({
      totals,
      uploads: uploadSummary,
      rooms: rooms.length,
    }),
    pipeline: safeHealth.previewQueue,
    components: safeHealth.components,
    history: {
      intervalSec: SAMPLE_INTERVAL_SEC,
      maxPoints: HISTORY_POINTS,
      points: [],
    },
    privacy: {
      aggregationOnly: true,
      excluded: ["room names", "user names", "file names", "internal paths"],
    },
  };
}

function historyPoint(snapshot) {
  return {
    at: snapshot.generatedAt,
    status: snapshot.service.status,
    storageBytes: snapshot.capacity.uploads.logicalBytes,
    files: snapshot.capacity.uploads.files,
    rooms: snapshot.community.rooms,
    usersOnline: snapshot.community.usersOnline,
    downloadsBytes: snapshot.activity.totals.downloadsBytes,
    downloadsServed: snapshot.activity.totals.downloadsServed,
  };
}

async function recordHistory(snapshot) {
  const locked = await redis.set(
    SAMPLE_LOCK_KEY,
    snapshot.generatedAt,
    "NX",
    "EX",
    SAMPLE_INTERVAL_SEC,
  );
  if (locked !== "OK") {
    return;
  }
  const point = historyPoint(snapshot);
  await redis.zadd(HISTORY_KEY, String(Date.parse(point.at)), JSON.stringify(point));
  await redis.zremrangebyrank(HISTORY_KEY, 0, -(HISTORY_POINTS + 1));
}

async function readHistory() {
  const raw = await redis.zrevrange(HISTORY_KEY, 0, HISTORY_POINTS - 1);
  return (raw || []).
    map(entry => {
      try {
        return JSON.parse(entry);
      }
      catch (_ex) {
        return null;
      }
    }).
    filter(Boolean).
    reverse();
}

async function collect({ Room, UPLOAD, REQUEST }) {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return cached.value;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    await UPLOAD.UPLOADS.loaded.catch(() => {});
    if (REQUEST && REQUEST.REQUESTS && REQUEST.REQUESTS.loaded) {
      await REQUEST.REQUESTS.loaded.catch(() => {});
    }
    const health = await OBS.health();
    const [roomsResult, usersResult, persistedResult] = await Promise.allSettled([
      Room.list(),
      redis.keys("user:pw:*"),
      OBS.persistentSnapshot(),
    ]);
    const rooms =
      roomsResult.status === "fulfilled" ? roomsResult.value : [];
    const users =
      usersResult.status === "fulfilled" ? usersResult.value : [];
    const persisted = persistedResult.status === "fulfilled" ?
      persistedResult.value :
      { startedAt: null, totals: {} };
    const snapshot = buildSnapshot({
      health,
      rooms,
      uploads: UPLOAD.UPLOADS.values(),
      requests:
        REQUEST && REQUEST.REQUESTS ? REQUEST.REQUESTS.values() : [],
      registeredUsers: (users || []).length,
      persisted,
    });
    snapshot.community.dataAvailable = roomsResult.status === "fulfilled";
    snapshot.activity.dataAvailable = persistedResult.status === "fulfilled";
    try {
      await recordHistory(snapshot);
      snapshot.history.points = await readHistory();
    }
    catch (ex) {
      console.warn("Failed updating public status history", ex.message || ex);
      snapshot.history.points = [historyPoint(snapshot)];
    }
    cached = { at: Date.now(), value: snapshot };
    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  const result = await inFlight;
  return result;
}

function startSampler(dependencies) {
  const sample = () =>
    collect(dependencies).catch(ex =>
      console.warn("Public status sample failed", ex.message || ex),
    );
  const initial = setTimeout(sample, 10 * 1000);
  const interval = setInterval(sample, SAMPLE_INTERVAL_SEC * 1000);
  if (typeof initial.unref === "function") {
    initial.unref();
  }
  if (typeof interval.unref === "function") {
    interval.unref();
  }
  return interval;
}

module.exports = {
  HISTORY_POINTS,
  SAMPLE_INTERVAL_SEC,
  REQUEST_BUCKETS,
  REQUEST_WINDOW_SEC,
  buildInsights,
  buildSnapshot,
  collect,
  historyPoint,
  sanitizeHealth,
  startSampler,
  summarizeRequests,
  summarizeUploads,
};
