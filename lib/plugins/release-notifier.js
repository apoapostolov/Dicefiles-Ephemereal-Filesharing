"use strict";

const FILE_EVENTS = new Set(["file_uploaded", "linked_file_appeared"]);

function truncate(value, max) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return "Unknown size";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = size;
  let unit = units[0];
  for (let i = 1; i < units.length && n >= 1024; i++) {
    n /= 1024;
    unit = units[i];
  }
  const digits = n >= 10 || unit === "B" ? 0 : 1;
  return `${n.toFixed(digits)} ${unit}`;
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(raw);
  }
  catch (_) {
    throw new Error("baseUrl must be a valid http or https URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("baseUrl must use http or https");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function resolveBaseUrl(ctx, config) {
  const explicit = config && config.baseUrl;
  const runtime = ctx && ctx.publicBaseUrl;
  const baseUrl = normalizeBaseUrl(explicit || runtime || "");
  if (!baseUrl) {
    throw new Error(
      "baseUrl is required (set it in the plugin or as publicBaseUrl in server config)",
    );
  }
  return baseUrl;
}

function absoluteUrl(baseUrl, href) {
  const value = String(href || "").trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return new URL(value || "/", `${baseUrl}/`).toString();
}

async function buildRelease(ctx, event, payload) {
  if (!FILE_EVENTS.has(event)) {
    return null;
  }
  const config = (ctx && ctx.config) || {};
  const roomId = String(payload && payload.roomid || "").trim();
  if (!roomId || !payload || !payload.key) {
    return null;
  }
  if (config.roomId && String(config.roomId) !== roomId) {
    return null;
  }
  if (config.ignoreBotUploads === true && payload.meta && payload.meta.bot) {
    return null;
  }

  let room = null;
  if (
    ctx &&
    ctx.dicefiles &&
    typeof ctx.dicefiles.getRoomSummary === "function"
  ) {
    room = await ctx.dicefiles.getRoomSummary(roomId);
  }
  const baseUrl = resolveBaseUrl(ctx, config);
  const uploaded = Number(payload.uploaded);
  return {
    event,
    key: String(payload.key),
    roomId,
    roomName:
      room && room.name ?
        String(room.name) :
        String(payload.roomName || roomId),
    roomUrl: absoluteUrl(baseUrl, `/r/${encodeURIComponent(roomId)}`),
    fileName: truncate(payload.name || "Unnamed release", 256),
    fileUrl: absoluteUrl(
      baseUrl,
      payload.href || `/g/${encodeURIComponent(payload.key)}`,
    ),
    size: Number(payload.size),
    sizeLabel: formatBytes(payload.size),
    type: String(payload.type || "file"),
    uploadedAt: Number.isFinite(uploaded) ?
      new Date(uploaded).toISOString() :
      new Date().toISOString(),
    isLinked: event === "linked_file_appeared",
    sourceRoomName: String(payload.sourceRoomName || ""),
  };
}

function deliveryScope(ctx, release) {
  return [
    ctx && ctx.pluginId || "release-notifier",
    release.roomId,
  ].join(":");
}

function deliveryEventId(release) {
  return `${release.event}:${release.key}`;
}

async function deliverWithRetry(ctx, release, deliver) {
  const attempts = 3;
  const baseDelayMs =
    ctx && Number.isFinite(Number(ctx.deliveryRetryBaseMs)) ?
      Math.max(0, Number(ctx.deliveryRetryBaseMs)) :
      500;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await deliver(release);
    }
    catch (ex) {
      lastError = ex;
      if (attempt >= attempts || ex && ex.retryable === false) {
        break;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function deliverReleaseOnce(ctx, event, payload, deliver) {
  const release = await buildRelease(ctx, event, payload);
  if (!release) {
    return { ok: true, skipped: true, reason: "not_applicable" };
  }

  let lease = null;
  if (ctx && ctx.events && typeof ctx.events.begin === "function") {
    lease = await ctx.events.begin(
      deliveryScope(ctx, release),
      deliveryEventId(release),
    );
    if (!lease) {
      return { ok: true, skipped: true, reason: "already_delivered" };
    }
  }

  try {
    const result = await deliverWithRetry(ctx, release, deliver);
    if (lease && typeof ctx.events.complete === "function") {
      await ctx.events.complete(lease);
    }
    return { ok: true, skipped: false, release, result };
  }
  catch (ex) {
    if (lease && typeof ctx.events.fail === "function") {
      await Promise.resolve(ctx.events.fail(lease)).catch(() => {});
    }
    throw ex;
  }
}

module.exports = {
  FILE_EVENTS,
  truncate,
  formatBytes,
  normalizeBaseUrl,
  resolveBaseUrl,
  absoluteUrl,
  buildRelease,
  deliveryScope,
  deliveryEventId,
  deliverWithRetry,
  deliverReleaseOnce,
};
