"use strict";

/**
 * Automation API auth, scopes, and rate limiting.
 * Extracted from httpserver so routes can share a stable contract.
 */

const path = require("path");
const CONFIG = require("../config");
const BROKER = require("../broker");
const { User } = require("../user");
const {
  asArray,
  asPositiveInt,
  appendJSONLine,
  sendApiError,
} = require("./helpers");

const AUTOMATION_SCOPE_PRESETS = Object.freeze({
  "read-only": ["files:read"],
  upload: ["files:read", "rooms:write", "uploads:write", "requests:write"],
  mod: [
    "files:read",
    "files:write",
    "files:delete",
    "rooms:write",
    "uploads:write",
    "requests:write",
    "room-links:read",
    "room-links:write",
    "federation-links:read",
    "federation-links:write",
    "guest-invites:read",
    "guest-invites:write",
    "admin:read",
    "admin:config",
    "admin:rooms",
    "mod:*",
  ],
});

function normalizeAutomationKeyEntry(entry, index) {
  if (typeof entry === "string") {
    const key = entry.trim();
    if (!key) {
      return null;
    }
    return {
      id: `legacy-${index + 1}`,
      key,
      scopes: new Set(["*"]),
    };
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const key = (entry.key || "").toString().trim();
  if (!key) {
    return null;
  }
  const preset = (entry.preset || entry.role || "")
    .toString()
    .trim()
    .toLowerCase();
  let scopes = asArray(entry.scopes)
    .map((s) => (s || "").toString().trim())
    .filter(Boolean);
  if (!scopes.length && preset && AUTOMATION_SCOPE_PRESETS[preset]) {
    scopes = AUTOMATION_SCOPE_PRESETS[preset].slice();
  }
  if (!scopes.length) {
    scopes = ["*"];
  }
  return {
    id: (entry.id || `key-${index + 1}`).toString(),
    key,
    scopes: new Set(scopes),
  };
}

function loadAutomationKeyConfig() {
  const items = asArray(CONFIG.get("automationApiKeys"));
  const records = items.map(normalizeAutomationKeyEntry).filter(Boolean);
  const byKey = new Map(records.map((r) => [r.key, r]));
  return {
    records,
    byKey,
  };
}

const AUTOMATION_KEYS = loadAutomationKeyConfig();

const AUTOMATION_RATE_DEFAULT = (() => {
  const cfg = CONFIG.get("automationApiRateLimit") || {};
  return {
    windowMs: asPositiveInt(cfg.windowMs, 60000, 1000, 10 * 60 * 1000),
    max: asPositiveInt(cfg.max, 180, 1, 100000),
  };
})();

const AUTOMATION_RATE_SCOPE = (() => {
  const cfg = CONFIG.get("automationApiRateLimitByScope") || {};
  const out = new Map();
  for (const [scope, value] of Object.entries(cfg)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    out.set(scope, {
      windowMs: asPositiveInt(
        value.windowMs,
        AUTOMATION_RATE_DEFAULT.windowMs,
        1000,
        10 * 60 * 1000,
      ),
      max: asPositiveInt(value.max, AUTOMATION_RATE_DEFAULT.max, 1, 100000),
    });
  }
  return out;
})();

const AUTOMATION_RATE_STATE = new Map();
const AUTOMATION_RATE_MAX_ENTRIES = 50_000;

setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of AUTOMATION_RATE_STATE.entries()) {
      if (!v || now >= v.resetAt + 10 * 60 * 1000) {
        AUTOMATION_RATE_STATE.delete(k);
      }
    }
    const { size } = AUTOMATION_RATE_STATE;
    if (size > AUTOMATION_RATE_MAX_ENTRIES) {
      console.warn(
        "[memory] AUTOMATION_RATE_STATE exceeds",
        AUTOMATION_RATE_MAX_ENTRIES,
        "entries (current:",
        `${size}).`,
        "This may indicate key-space abuse.",
      );
    }
    else {
      console.debug("[memory] AUTOMATION_RATE_STATE size:", size);
    }
  },
  5 * 60 * 1000,
);

const AUTOMATION_AUDIT_LOG = (() => {
  const logPath = (CONFIG.get("automationAuditLog") || "").toString().trim();
  if (!logPath) {
    return null;
  }
  if (path.isAbsolute(logPath)) {
    return logPath;
  }
  return path.join(process.cwd(), logPath);
})();

function scopeAllowed(scopes, needed) {
  if (!needed) {
    return true;
  }
  if (scopes.has("*")) {
    return true;
  }
  if (scopes.has(needed)) {
    return true;
  }
  const idx = needed.indexOf(":");
  if (idx > 0) {
    const prefix = needed.slice(0, idx + 1);
    if (scopes.has(`${prefix}*`)) {
      return true;
    }
  }
  return false;
}

function rateLimitForScope(scope) {
  return AUTOMATION_RATE_SCOPE.get(scope) || AUTOMATION_RATE_DEFAULT;
}

const _redisRL = BROKER.getMethods("ratelimit");

function _checkRateLimitLocal(keyId, scope, limit) {
  const bucketKey = `${keyId}:${scope || "*"}`;
  const now = Date.now();
  let bucket = AUTOMATION_RATE_STATE.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    AUTOMATION_RATE_STATE.set(bucketKey, bucket);
  }
  if (AUTOMATION_RATE_STATE.size > AUTOMATION_RATE_MAX_ENTRIES) {
    return {
      limited: true,
      limit,
      remaining: 0,
      resetAt: bucket.resetAt,
      overflow: true,
    };
  }
  bucket.count += 1;
  return {
    limited: bucket.count > limit.max,
    limit,
    remaining: Math.max(0, limit.max - bucket.count),
    resetAt: bucket.resetAt,
  };
}

async function checkAutomationRateLimit(keyId, scope) {
  const limit = rateLimitForScope(scope);
  const bucketKey = `rl:automation:${keyId}:${scope || "*"}`;
  try {
    const [count, ttlMs] = await _redisRL.ratelimit(bucketKey, limit.windowMs);
    const resetAt = Date.now() + (Number(ttlMs) || limit.windowMs);
    return {
      limited: count > limit.max,
      limit,
      remaining: Math.max(0, limit.max - count),
      resetAt,
    };
  }
  catch (ex) {
    console.debug(
      "[rate-limit] redis fallback:",
      ex && ex.message ? ex.message : ex,
    );
    return _checkRateLimitLocal(keyId, scope, limit);
  }
}

function parseAutomationApiKey(req) {
  const h = req.headers || {};
  const auth = (h.authorization || "").toString();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return (h["x-dicefiles-api-key"] || "").toString().trim();
}

function automationRouteScope(req) {
  return req.automationScope || req.routeScope || "unknown";
}

function auditAutomationRequest(req, status, extra = {}) {
  appendJSONLine(
    AUTOMATION_AUDIT_LOG,
    Object.assign(
      {
        at: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status,
        scope: automationRouteScope(req),
        apiKeyId: req.automationKeyId || "",
        account: (req.automationUser && req.automationUser.account) || "",
      },
      extra,
    ),
  );
}

function requireAutomation(scope = null) {
  return async function (req, res, next) {
    try {
      req.automationScope = scope || "unknown";
      const key = parseAutomationApiKey(req);
      if (!key) {
        auditAutomationRequest(req, 401, { err: "Missing automation API key" });
        return sendApiError(res, 401, "Invalid automation API key");
      }
      const record = AUTOMATION_KEYS.byKey.get(key);
      if (!record) {
        auditAutomationRequest(req, 401, { err: "Invalid automation API key" });
        return sendApiError(res, 401, "Invalid automation API key");
      }
      if (!scopeAllowed(record.scopes, scope)) {
        auditAutomationRequest(req, 403, { err: "Insufficient scope" });
        return sendApiError(res, 403, "Insufficient scope");
      }
      const rl = await checkAutomationRateLimit(record.id, scope);
      res.setHeader("X-RateLimit-Limit", String(rl.limit.max));
      res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
      if (rl.limited) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        );
        auditAutomationRequest(req, 429, { err: "Rate limited" });
        return sendApiError(res, 429, "Rate limited");
      }
      req.automationKey = key;
      req.automationKeyId = record.id;
      req.automationKeyScopes = Array.from(record.scopes);
      return next();
    }
    catch (ex) {
      console.error("requireAutomation", ex);
      return sendApiError(res, 500, "Internal error");
    }
  };
}

function logAutomationResponse(req, res, next) {
  if (
    !req.path.startsWith("/api/automation/") &&
    !req.path.startsWith("/api/v1/")
  ) {
    return next();
  }
  const start = Date.now();
  res.on("finish", () => {
    auditAutomationRequest(req, res.statusCode, {
      durationMs: Date.now() - start,
    });
  });
  return next();
}

async function getAutomationUser(req, res, next) {
  try {
    const bodySession = req.body && req.body.session;
    const querySession = req.query && req.query.session;
    const headerSession = req.headers["x-dicefiles-session"];
    const session = (headerSession || bodySession || querySession || "")
      .toString()
      .trim();
    req.automationSession = session;
    if (!session) {
      req.automationUser = null;
      return next();
    }
    const user = await User.load(session);
    if (!user) {
      return sendApiError(res, 401, "Invalid automation session");
    }
    req.automationUser = user;
    req.user = user;
    return next();
  }
  catch (ex) {
    return sendApiError(res, 500, ex.message || ex.toString());
  }
}

function requireAutomationUser(req, res, next) {
  if (!req.automationUser) {
    return sendApiError(res, 401, "Automation session required");
  }
  return next();
}

module.exports = {
  AUTOMATION_SCOPE_PRESETS,
  AUTOMATION_KEYS,
  AUTOMATION_RATE_STATE,
  AUTOMATION_RATE_MAX_ENTRIES,
  normalizeAutomationKeyEntry,
  loadAutomationKeyConfig,
  scopeAllowed,
  rateLimitForScope,
  checkAutomationRateLimit,
  _checkRateLimitLocal,
  parseAutomationApiKey,
  requireAutomation,
  logAutomationResponse,
  getAutomationUser,
  requireAutomationUser,
  auditAutomationRequest,
};
