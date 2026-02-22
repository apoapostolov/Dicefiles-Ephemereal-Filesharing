"use strict";

const cookie = require("cookie");
const fs = require("fs");
const path = require("path");
const { createServer } = require("http");
const { createServer: createTLSServer } = require("https");
const express = require("express");
const bodyParser = require("body-parser");
const ss = require("serve-static");
const sio = require("socket.io");
const { Client } = require("./client");
const { Room } = require("./room");
const v = require("./clientversion");
const verifier = require("./sessionverifier");
const { token, toMessage, toPrettySize, toPrettyInt } = require("./util");
const { Stats, User } = require("./user");
const bans = require("./bans");
const UPLOAD = require("./upload");
const META = require("./meta");
const { EMITTER: REQUEST_EMITTER, REQUESTS } = require("./request");
const { StorageLocation, STORAGE } = require("./storage");
const { ingestFromBuffer } = require("./upload");
let sharp;
try {
  sharp = require("sharp");
} catch (_) {
  sharp = null;
}
const { computeAchievements } = require("./achievements");
const { renderMarkdown } = require("./markdown");
const CONFIG = require("./config");
const WEBHOOKS = require("./webhooks");
const OBS = require("./observability");
const { requireString, optionalString } = require("./validate");
// BROKER is needed for distributed rate limiting and room messages.
const BROKER = require("./broker");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set(["terms", "rules"]);

const NAME = CONFIG.get("name");
const MOTTO = CONFIG.get("motto");

const sekrit = CONFIG.get("secret");
const STTL = CONFIG.get("sessionTTL");

function hmactoken(d) {
  return d ? verifier.generate(sekrit, d) : "";
}

function rtoken(req) {
  return hmactoken(req.cookies && req.cookies.kft);
}

function rtokenize(fn) {
  return async function (req, res) {
    try {
      const e = hmactoken(req.cookies.kft);
      if (e !== req.body.token) {
        throw new Error("Invalid request token");
      }
      delete req.body.token;
      let rv = fn(req, res);
      if (rv && rv.then) {
        rv = await rv;
      }
      res.json(rv);
    } catch (ex) {
      console.error(fn.name || "<wrapped handler>", ex);
      res.json({ err: ex.message || ex.toString() });
    }
  };
}

function render(res, page, ctx) {
  ctx = Object.assign(
    {
      NAME,
      MOTTO,
      v,
      get token() {
        return rtoken(res.req);
      },
    },
    ctx,
  );
  return res.render(page, ctx);
}

async function injectkft(req, res, next) {
  try {
    if (!req.cookies) {
      req.cookies = {};
    }
    if (!req.cookies.kft) {
      req.cookies.kft = await token();
      res.cookie("kft", req.cookies.kft, {
        httpOnly: true,
        secure: req.secure,
        sameSite: "Strict",
      });
    }
  } catch (ex) {
    console.error(ex);
  }
  if (next) {
    next();
  }
}

async function getUser(req, _, next) {
  const user = req.cookies.session && (await User.load(req.cookies.session));
  req.user = user || null;
  if (next) {
    next();
  }
}

function aroute(fn) {
  return async function (req, res, next) {
    try {
      return await fn(req, res, next);
    } catch (ex) {
      return next && next(ex);
    }
  };
}

function requireMod(req) {
  if (!req.user || req.user.role !== "mod") {
    throw new Error("Not authorized");
  }
}

function asArray(v) {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    return [v.trim()];
  }
  return [];
}

function appendJSONLine(file, payload) {
  if (!file) {
    return;
  }
  fs.appendFile(file, `${JSON.stringify(payload)}\n`, () => {});
}

function asPositiveInt(v, fallback, min = 1, max = 1000000) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(n)));
}

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
    "admin:read",
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

// Periodic cleanup and diagnostics for AUTOMATION_RATE_STATE.
// Removes expired buckets to prevent unbounded memory growth, and logs a
// warning if the map exceeds a safe size ceiling (sign of abuse / runaway keys).
const AUTOMATION_RATE_MAX_ENTRIES = 50_000;
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of AUTOMATION_RATE_STATE.entries()) {
      if (!v || now >= v.resetAt + 10 * 60 * 1000) {
        AUTOMATION_RATE_STATE.delete(k);
      }
    }
    const size = AUTOMATION_RATE_STATE.size;
    if (size > AUTOMATION_RATE_MAX_ENTRIES) {
      console.warn(
        "[memory] AUTOMATION_RATE_STATE exceeds",
        AUTOMATION_RATE_MAX_ENTRIES,
        "entries (current:",
        size + ").",
        "This may indicate key-space abuse.",
      );
    } else {
      console.debug("[memory] AUTOMATION_RATE_STATE size:", size);
    }
  },
  5 * 60 * 1000,
);

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

// Distributed Redis-backed rate limiting for the automation API.
// Falls back to the in-process Map on Redis errors so a transient Redis
// blip never blocks automation traffic entirely.
//
// The `ratelimit-1.lua` script atomically INCRements a key and sets a PEXPIRE
// on first access, then returns [count, remaining_ttl_ms].  This gives
// accurate per-window counts across all workers sharing the same Redis.

const _redisRL = BROKER.getMethods("ratelimit");

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
  } catch (ex) {
    // Redis unavailable — fall back to in-process bucket (fail open).
    console.warn(
      "[rate-limiting] Redis ratelimit unavailable, using in-process fallback:",
      ex.message,
    );
    return _checkRateLimitLocal(keyId, scope, limit);
  }
}

function _checkRateLimitLocal(keyId, scope, limit) {
  const bucketKey = `${keyId}|${scope || "*"}`;
  const now = Date.now();
  let state = AUTOMATION_RATE_STATE.get(bucketKey);
  if (!state || now >= state.resetAt) {
    if (!state && AUTOMATION_RATE_STATE.size >= AUTOMATION_RATE_MAX_ENTRIES) {
      return {
        limited: true,
        limit,
        remaining: 0,
        resetAt: now + limit.windowMs,
      };
    }
    state = { count: 0, resetAt: now + limit.windowMs };
  }
  state.count += 1;
  AUTOMATION_RATE_STATE.set(bucketKey, state);
  return {
    limited: state.count > limit.max,
    limit,
    remaining: Math.max(0, limit.max - state.count),
    resetAt: state.resetAt,
  };
}

function sendApiError(res, status, err) {
  res.status(status);
  res.json({ err });
}

function jroute(fn) {
  return async function (req, res) {
    try {
      const rv = await fn(req, res);
      if (!res.headersSent) {
        res.json(rv === undefined ? null : rv);
      }
    } catch (ex) {
      console.error(fn.name || "<json route>", ex);
      if (!res.headersSent) {
        sendApiError(res, 400, ex.message || ex.toString());
      }
    }
  };
}

function parseAutomationApiKey(req) {
  const auth = (req.headers.authorization || "").toString();
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return (req.headers["x-dicefiles-api-key"] || "").toString().trim();
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
        status,
        method: req.method,
        path: req.originalUrl || req.url,
        scope: automationRouteScope(req),
        apiKeyId: req.automationKeyId || "",
        account: (req.automationUser && req.automationUser.account) || "",
        ip: req.ip,
      },
      extra,
    ),
  );
}

function requireAutomation(scope = null) {
  // Middleware is async to await the distributed Redis-backed rate limiter.
  // Unhandled rejections are caught and forwarded to next(err).
  return async function (req, res, next) {
    try {
      req.automationScope = scope || "unknown";
      if (!AUTOMATION_KEYS.records.length) {
        auditAutomationRequest(req, 404, { err: "Automation API is disabled" });
        return sendApiError(res, 404, "Automation API is disabled");
      }
      const key = parseAutomationApiKey(req);
      const record = key && AUTOMATION_KEYS.byKey.get(key);
      if (!record) {
        auditAutomationRequest(req, 401, { err: "Invalid automation API key" });
        return sendApiError(res, 401, "Invalid automation API key");
      }
      if (!scopeAllowed(record.scopes, scope)) {
        auditAutomationRequest(req, 403, {
          err: "API key missing required scope",
          requiredScope: scope || "",
          apiKeyId: record.id,
        });
        return sendApiError(res, 403, "API key missing required scope");
      }
      const rate = await checkAutomationRateLimit(record.id, scope || "*");
      if (rate.limited) {
        res.setHeader(
          "Retry-After",
          Math.ceil((rate.resetAt - Date.now()) / 1000),
        );
        auditAutomationRequest(req, 429, {
          err: "Automation API rate limit exceeded",
          requiredScope: scope || "",
          apiKeyId: record.id,
          windowMs: rate.limit.windowMs,
          max: rate.limit.max,
        });
        return sendApiError(res, 429, "Automation API rate limit exceeded");
      }
      req.automationKey = key;
      req.automationKeyId = record.id;
      req.automationKeyScopes = Array.from(record.scopes);
      res.setHeader("X-Dicefiles-RateLimit-Limit", rate.limit.max);
      res.setHeader("X-Dicefiles-RateLimit-Remaining", rate.remaining);
      res.setHeader(
        "X-Dicefiles-RateLimit-Reset",
        Math.ceil(rate.resetAt / 1000),
      );
      return next();
    } catch (ex) {
      return next(ex);
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
  const started = Date.now();
  res.on("finish", () => {
    auditAutomationRequest(req, res.statusCode, {
      durationMs: Date.now() - started,
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
  } catch (ex) {
    return sendApiError(res, 500, ex.message || ex.toString());
  }
}

function requireAutomationUser(req, res, next) {
  if (!req.automationUser) {
    return sendApiError(res, 401, "Automation session required");
  }
  return next();
}

function validateRequestPayload(payload) {
  let text = "";
  let requestUrl = "";
  let requestImageDataUrl = "";
  if (payload && typeof payload === "object") {
    text = (payload.text || "").toString().trim();
    requestUrl = (payload.url || "").toString().trim();
    requestImageDataUrl = (payload.requestImage || "").toString().trim();
  } else {
    text = (payload || "").toString().trim();
  }
  if (!text) {
    throw new Error("Request text is empty");
  }
  if (text.length > 200) {
    throw new Error("Request text is too long");
  }
  if (requestUrl.length > 500) {
    throw new Error("Request URL is too long");
  }
  if (requestUrl) {
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch (ex) {
      throw new Error("Request URL is invalid");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Request URL must use http or https");
    }
  }
  if (requestImageDataUrl) {
    if (requestImageDataUrl.length > 2_500_000) {
      throw new Error("Request image is too large");
    }
    if (
      !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(
        requestImageDataUrl,
      )
    ) {
      throw new Error("Request image format is invalid");
    }
  }
  return {
    text,
    requestUrl,
    requestImageDataUrl,
  };
}

const ss_opts = {
  immutable: true,
  maxAge: 2592000000,
  index: false,
  redirect: false,
};

const app = express();
app.disable("x-powered-by");
if (CONFIG.get("considerProxyForwardedForHeaders")) {
  app.enable("trust proxy");
}
app.set("view engine", "ejs");
app.set("etag", "strong");

if (app.get("env") === "production") {
  app.use(require("compression")());
}
app.use(
  // Helmet 7: xssFilter and ieNoOpen were removed in Helmet 5+; they set
  // legacy headers (X-XSS-Protection / X-Download-Options) that are no longer recommended.
  // HSTS: applied only when the request arrived over HTTPS (req.secure) to
  // avoid breaking plain HTTP development instances.
  require("helmet")({
    hsts: false, // We set HSTS conditionally via middleware below
    xPoweredBy: true, // Remove X-Powered-By
  }),
);

// Conditional HSTS — only sent over actual HTTPS connections so development
// instances over plain HTTP are not affected.
app.use(function conditionalHsts(req, res, next) {
  if (req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains",
    );
  }
  next();
});

app.use(require("cookie-parser")());

app.get("/g/:key/:name", getUser, UPLOAD.serve);
app.get("/g/:key", getUser, UPLOAD.serve);

app.get(
  "/healthz",
  aroute(async (req, res) => {
    const health = await OBS.health();
    res.status(health.ok ? 200 : 503);
    res.json(health);
  }),
);

app.use(injectkft);

// CSP
app.use(function (req, res, next) {
  // Use a reasonable strict/lenient balance.
  // 'unsafe-eval' in script-src is required for the PDF.js web worker which uses
  // eval() internally for PostScript/Type4 function rendering. Without it,
  // certain PDFs render partially and the browser logs a CSP warning.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline' blob:; " +
      "style-src-elem 'self' 'unsafe-inline' blob:; " +
      "img-src 'self' data: blob: https: http:; " +
      "media-src *; " +
      "connect-src 'self' https://api.giphy.com https://tenor.googleapis.com https://g.tenor.com",
  );
  next();
});

app.get("/", function (req, res) {
  render(res, "index", { v });
});

app.put("/api/upload/:key", getUser, UPLOAD.upload);

app.post("*", bodyParser.json());
app.use(logAutomationResponse);

function v1(pathname) {
  return [`/api/automation${pathname}`, `/api/v1${pathname}`];
}

app.post(
  v1("/auth/login"),
  requireAutomation("auth:login"),
  jroute(async (req) => {
    const { username, password, twofactor } = req.body || {};
    if (!username || !password) {
      throw new Error("username and password are required");
    }
    const rv = await User.login(req.ip, username, password, twofactor);
    return Object.assign({ ok: true }, rv);
  }),
);

app.post(
  v1("/auth/logout"),
  requireAutomation("auth:logout"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    await User.logout(req.automationSession);
    return { ok: true };
  }),
);

app.post(
  v1("/rooms"),
  requireAutomation("rooms:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const room = await Room.create(req.ip, req.automationUser, rtoken(req));
    return {
      ok: true,
      roomid: room.roomid,
      href: `/r/${room.roomid}`,
    };
  }),
);

app.post(
  v1("/requests"),
  requireAutomation("requests:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const { roomid } = req.body || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const { text, requestUrl, requestImageDataUrl } = validateRequestPayload(
      req.body,
    );
    const hintsRaw = req.body && req.body.hints;
    const hints =
      hintsRaw && typeof hintsRaw === "object" && !Array.isArray(hintsRaw)
        ? hintsRaw
        : {};
    const user = req.automationUser;
    const ban = await bans.findBan("upload", req.ip, user && user.account);
    if (ban && user.role !== "mod") {
      throw new Error(ban.toUserMessage("upload"));
    }
    const request = await REQUEST_EMITTER.createRequest(
      roomid,
      text,
      requestUrl,
      req.ip,
      user.name,
      user.role,
      user.account,
      room.fileTTL,
      requestImageDataUrl,
      hints,
    );
    BROKER.emit(`${roomid}:message`, {
      notify: true,
      user: "System",
      role: "system",
      msg: await toMessage(
        `REQUEST by ${user.name}: ${text}${requestUrl ? ` (${requestUrl})` : ""}`,
      ),
    });
    return {
      ok: true,
      request: request.toClientJSON(),
    };
  }),
);

app.post(
  v1("/uploads/key"),
  requireAutomation("uploads:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const { roomid } = req.body || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const user = req.automationUser;
    if (user.role !== "mod") {
      const ban = await bans.findBan("upload", req.ip, user.account);
      if (ban) {
        throw new Error(ban.toUserMessage("upload"));
      }
    }
    const key = await token(20);
    await UPLOAD.registerUploadKey(roomid, user.name, key, room.fileTTL);
    return {
      ok: true,
      key,
      ttlHours: room.fileTTL,
    };
  }),
);

app.get(
  v1("/uploads/:key/offset"),
  requireAutomation("uploads:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    return {
      ok: true,
      key: req.params.key,
      offset: await UPLOAD.queryOffset(req.params.key),
    };
  }),
);

app.put(
  v1("/uploads/:key"),
  requireAutomation("uploads:write"),
  getAutomationUser,
  requireAutomationUser,
  UPLOAD.upload,
);

app.get(
  v1("/files"),
  requireAutomation("files:read"),
  getAutomationUser,
  jroute(async (req) => {
    const { roomid } = req.query || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const role = req.automationUser ? req.automationUser.role : "white";
    const files = await room.files.for(role, req.ip);
    const since = parseInt(req.query.since, 10);
    const type = (req.query.type || "all").toString();

    let filtered = files;
    if (type === "uploads") {
      filtered = filtered.filter((f) => !(f.meta && f.meta.request));
    } else if (type === "requests") {
      filtered = filtered.filter((f) => f.meta && f.meta.request);
    } else if (type === "new") {
      if (!isFinite(since) || since <= 0) {
        throw new Error("since is required for type=new");
      }
      filtered = filtered.filter((f) => Number(f.uploaded) > since);
    } else if (type !== "all") {
      throw new Error("Invalid type; expected all|uploads|requests|new");
    }

    // Optional name / extension filters (case-insensitive)
    const nameContains = (req.query.name_contains || "")
      .toString()
      .trim()
      .toLowerCase();
    const extParam = (req.query.ext || "").toString().trim().toLowerCase();
    const extList = extParam
      ? extParam.split(",").map((e) => e.replace(/^\./, ""))
      : [];
    if (nameContains) {
      filtered = filtered.filter((f) =>
        (f.name || "").toLowerCase().includes(nameContains),
      );
    }
    if (extList.length) {
      filtered = filtered.filter((f) => {
        const dot = (f.name || "").lastIndexOf(".");
        const fileExt = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
        return extList.includes(fileExt);
      });
    }

    return {
      ok: true,
      roomid,
      count: filtered.length,
      files: filtered.map((f) =>
        Object.assign({}, f, {
          isNew:
            isFinite(since) && since > 0 ? Number(f.uploaded) > since : false,
        }),
      ),
    };
  }),
);

app.get(
  v1("/downloads"),
  requireAutomation("files:read"),
  getAutomationUser,
  jroute(async (req) => {
    const { roomid } = req.query || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const role = req.automationUser ? req.automationUser.role : "white";
    const files = await room.files.for(role, req.ip);
    const since = parseInt(req.query.since, 10);
    const scope = (req.query.scope || "all").toString();
    let downloads = files.filter((f) => !(f.meta && f.meta.request));
    if (scope === "new") {
      if (!isFinite(since) || since <= 0) {
        throw new Error("since is required for scope=new");
      }
      downloads = downloads.filter((f) => Number(f.uploaded) > since);
    } else if (scope !== "all") {
      throw new Error("Invalid scope; expected all|new");
    }

    // Optional name / extension filters (case-insensitive)
    const nameContains = (req.query.name_contains || "")
      .toString()
      .trim()
      .toLowerCase();
    const extParam = (req.query.ext || "").toString().trim().toLowerCase();
    const extList = extParam
      ? extParam.split(",").map((e) => e.replace(/^\./, ""))
      : [];
    if (nameContains) {
      downloads = downloads.filter((f) =>
        (f.name || "").toLowerCase().includes(nameContains),
      );
    }
    if (extList.length) {
      downloads = downloads.filter((f) => {
        const dot = (f.name || "").lastIndexOf(".");
        const fileExt = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
        return extList.includes(fileExt);
      });
    }
    return {
      ok: true,
      roomid,
      count: downloads.length,
      files: downloads.map((f) => ({
        key: f.key,
        name: f.name,
        size: f.size,
        uploaded: f.uploaded,
        href: f.href || `/g/${f.key}`,
      })),
    };
  }),
);

app.post(
  v1("/files/delete"),
  requireAutomation("files:delete"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const { roomid, keys } = req.body || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    if (!Array.isArray(keys) || !keys.length) {
      throw new Error("keys[] is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const user = req.automationUser;
    let removed = 0;
    if (user.role === "mod" || room.owns(user.account, rtoken(req))) {
      removed = await room.trash(keys);
    } else {
      removed = await room.trashOwned(keys, req.ip, user.account);
    }
    return {
      ok: true,
      requested: keys.length,
      removed,
    };
  }),
);

app.post(
  "/api/register",
  rtokenize(async (req, res) => {
    const { u, p } = req.body || {};
    // Validate username and password lengths before processing.
    const validNick = requireString(u, "username", 32);
    const validPass = requireString(p, "password", 256);
    const rv = await User.create(req.ip, validNick, validPass);
    if (rv.session) {
      req.cookies.session = rv.session;
      res.cookie("session", req.cookies.session, {
        httpOnly: true,
        secure: req.secure,
        maxAge: STTL * 1000,
      });
    }
    return rv;
  }),
);

app.post(
  "/api/login",
  rtokenize(async (req, res) => {
    const { u, p, t } = req.body || {};
    // Validate username and password before processing.
    const validNick = requireString(u, "username", 32);
    const validPass = requireString(p, "password", 256);
    const rv = await User.login(req.ip, validNick, validPass, t);
    if (rv.session) {
      req.cookies.session = rv.session;
      req.cookies.verifier = verifier.generate(sekrit, rv.session);
      res.cookie("verifier", req.cookies.verifier, {
        httpOnly: false,
        secure: req.secure,
        maxAge: STTL * 1000,
        sameSite: "Strict",
      });
      res.cookie("session", req.cookies.session, {
        httpOnly: true,
        secure: req.secure,
        maxAge: STTL * 1000,
        sameSite: "Strict",
      });
    }
    return rv;
  }),
);

app.post(
  "/api/logout",
  rtokenize(async (req, res) => {
    if (!req.cookies.session) {
      return null;
    }
    await User.logout(req.cookies.session);
    delete req.cookies.session;
    res.clearCookie("session", {
      httpOnly: true,
      secure: req.secure,
    });
    return null;
  }),
);

app.use(getUser);

app.post(
  "/api/changepw",
  rtokenize(async (req) => {
    const { user } = req;
    if (!user) {
      throw new Error("Not logged in!");
    }

    const { c, p, t } = req.body || {};
    // Validate current and new password lengths.
    const validCurrent = requireString(c, "current password", 256);
    const validNew = requireString(p, "new password", 256);

    const rv = await user.changePassword(req.ip, validCurrent, validNew, t);
    return rv;
  }),
);

app.post(
  "/api/account",
  rtokenize(async (req) => {
    const { user } = req;
    if (!user) {
      throw new Error("Not logged in!");
    }
    switch (req.body.realm) {
      case "acct":
        return await user.adopt(req.body);

      case "tfa":
        return await user.setTwofactor(req.body);

      default:
        throw new Error("Invalid realm!");
    }
  }),
);

async function newRoom(req, res, next) {
  const { user } = req;
  const room = await Room.create(req.ip, user, rtoken(req));
  if (!room) {
    next();
    return;
  }
  res.redirect(`/r/${room.roomid}`);
}

app.get("/new", aroute(newRoom));
app.get("/r/new", aroute(newRoom));

app.get(
  "/r/:roomid",
  aroute(async function (req, res, next) {
    const room = await Room.get(req.params.roomid);
    if (!room) {
      next();
      return;
    }
    if (room.config.get("inviteonly")) {
      if (!req.user || req.user.role !== "mod") {
        const token = rtoken(req);
        if (!room.invited(req.user, token)) {
          next(new Error("You're not invited!"));
          return;
        }
      }
    }
    render(res, "room");
  }),
);

app.get(
  "/u/:user",
  aroute(async function (req, res, next) {
    const user = await User.get(req.params.user);
    if (!user) {
      next();
      return;
    }
    const info = Object.create(await user.getInfo());
    const { uploadStats: s } = info;
    if (s) {
      info.uploaded = toPrettySize(s.uploaded);
      info.files = toPrettyInt(s.files);
      info.downloaded = toPrettySize(s.downloaded);
      if (s.uploadedRank) {
        info.uploadedRank = `#${toPrettyInt(s.uploadedRank)}`;
      }
      if (s.filesRank) {
        info.filesRank = `#${toPrettyInt(s.filesRank)}`;
      }
      if (s.downloadedRank) {
        info.downloadedRank = `#${toPrettyInt(s.downloadedRank)}`;
      }
    }
    info.achievements = computeAchievements(info.uploadStats);
    info.messageHtml = renderMarkdown(user.message || "");
    info.canEditMessage = !!(req.user && req.user.account === user.account);
    info.recentUploads = await User.getRecentUploads(user.account, 20);
    render(res, "user", {
      pagename: `User ${user.name}`,
      user,
      info,
    });
  }),
);

app.all("/account", (req, res, next) => {
  const { user } = req;
  if (!user) {
    next(new Error("You are not logged in!"));
    return;
  }
  render(res, "account", {
    pagename: "Your Account",
    user,
  });
});

app.all("/register", (req, res, next) => {
  const { user } = req;
  if (user) {
    next(new Error("You are already logged in!"));
    return;
  }
  render(res, "register", {
    pagename: "Register",
  });
});

app.get(
  "/top/:list/:page?",
  aroute(async (req, res, next) => {
    const { list } = req.params;
    if (list !== "uploaded" && list !== "files") {
      next();
      return;
    }
    let { page } = req.params;
    page = parseInt(page, 10) || 0;
    try {
      render(res, "toplist", {
        pagename: "Top of the Crop",
        list,
        stats: await Stats.get(list, page),
      });
    } catch (ex) {
      console.error(ex);
      next();
    }
  }),
);

app.get(
  "/adiscover",
  aroute(async (req, res) => {
    requireMod(req);
    const rooms = (await Room.list()).filter((r) => r.users || r.files);
    const users = rooms.reduce((p, c) => p + c.users, 0);
    const files = rooms.reduce((p, c) => p + c.files, 0);
    render(res, "discover", {
      pagename: "Discover",
      rooms,
      users,
      files,
    });
  }),
);

app.get(
  "/modlog/revert/:id",
  aroute(async (req, res, next) => {
    requireMod(req);
    const record = await require("./bans").lookupLog(req.params.id);
    if (!record || !record.revert) {
      next(new Error("Record not found"));
      return;
    }
    const newrecord = await record.revert(req.user);
    if (!newrecord) {
      next(new Error("Nothing to be done!"));
      return;
    }
    res.redirect(`/modlog/${newrecord.id}`);
  }),
);

app.get(
  "/modlog/:id",
  aroute(async (req, res, next) => {
    requireMod(req);
    const record = await require("./bans").lookupLog(req.params.id);
    if (!record) {
      next();
      return;
    }
    if (record.files) {
      record.files.forEach((f) => {
        f.fmtSize = toPrettySize(f.size);
      });
    }
    render(res, "modlogdetail", {
      pagename: "Moderation Log",
      record,
    });
  }),
);

app.get(
  "/modlog",
  aroute(async (req, res) => {
    requireMod(req);
    const records = await require("./bans").getModLogs();
    render(res, "modlog", {
      pagename: "Moderation Log",
      records,
    });
  }),
);

// ── AI Automation API ─────────────────────────────────────────────────────────

// GET /api/v1/file/:key — single-file metadata point query
app.get(
  v1("/file/:key"),
  requireAutomation("files:read"),
  getAutomationUser,
  jroute(async (req) => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    const role = req.automationUser ? req.automationUser.role : "white";
    const file =
      role === "mod" ? up.toClientJSON() : up.hidden ? null : up.toClientJSON();
    if (!file) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    return { ok: true, file };
  }),
);

// PATCH /api/v1/file/:key — post-upload metadata update: tags, description,
// ai_caption, ocr_text_preview. Requires files:write scope.
app.patch(
  v1("/file/:key"),
  requireAutomation("files:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    const body = req.body || {};
    const ALLOWED_META = new Set([
      "description",
      "ai_caption",
      "ocr_text_preview",
      "archive_count",
      "archive_ext_sample",
    ]);
    const ALLOWED_TAGS = new Set([
      "title",
      "description",
      "genre",
      "language",
      "series",
      "author",
    ]);
    const patchMeta = {};
    if (body.meta && typeof body.meta === "object") {
      for (const [k, v] of Object.entries(body.meta)) {
        if (ALLOWED_META.has(k) && v != null) {
          patchMeta[k] = String(v).slice(0, 500);
        }
      }
    }
    const patchTags = {};
    if (body.tags && typeof body.tags === "object") {
      for (const [k, v] of Object.entries(body.tags)) {
        if (ALLOWED_TAGS.has(k) && v != null) {
          patchTags[k] = String(v).slice(0, 200);
        }
      }
    }
    const old = up.storage;
    const newStorage = new StorageLocation({
      ...old.toJSON(),
      meta: Object.assign({}, old.meta, patchMeta),
      tags: Object.assign({}, old.tags, patchTags),
    });
    STORAGE.set(old.hash, newStorage);
    BROKER.emit("storage-updated", old.hash);
    return { ok: true, key: up.key, hash: up.hash };
  }),
);

// POST /api/v1/file/:key/asset/cover — agent-supplied JPEG cover thumbnail
app.post(
  v1("/file/:key/asset/cover"),
  requireAutomation("files:write"),
  getAutomationUser,
  requireAutomationUser,
  express.raw({ limit: "5mb", type: () => true }),
  jroute(async (req) => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) {
      throw new Error("Empty or invalid body");
    }
    if (!sharp) {
      throw new Error("Image processing unavailable");
    }
    const cover = await sharp(body).jpeg({ quality: 85 }).toBuffer();
    // Build a new StorageLocation without the old cover asset, then add fresh one
    const old = up.storage;
    const assetsWithoutCover = Array.from(old.assets.entries()).filter(
      ([ext]) => ext !== ".cover.jpg",
    );
    const stripped = new StorageLocation({
      ...old.toJSON(),
      assets: assetsWithoutCover,
    });
    STORAGE.set(old.hash, stripped);
    await stripped.addAssets([
      { ext: ".cover.jpg", type: "image", mime: "image/jpeg", data: cover },
    ]);
    BROKER.emit("storage-updated", old.hash);
    return { ok: true, key: up.key, hash: up.hash };
  }),
);

// POST /api/v1/room/:id/chat — agents post a chat message to a room
app.post(
  v1("/room/:id/chat"),
  requireAutomation("rooms:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const roomid = req.params.id;
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const rawText = (req.body && req.body.text) || "";
    if (!rawText.trim()) {
      throw new Error("text is required");
    }
    if (rawText.length > 500) {
      throw new Error("text is too long (max 500 chars)");
    }
    const nick =
      (req.body && req.body.nick) || req.automationUser.name || "Agent";
    const replyTo = (req.body && req.body.replyTo) || undefined;
    BROKER.emit(`${roomid}:message`, {
      notify: false,
      user: nick,
      role: "agent",
      msg: await toMessage(rawText.trim()),
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true };
  }),
);

// GET /api/v1/room/:id/snapshot — compact room summary for agents
app.get(
  v1("/room/:id/snapshot"),
  requireAutomation("files:read"),
  getAutomationUser,
  jroute(async (req) => {
    const roomid = req.params.id;
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    const allFiles = await room.files.for("mod", "");
    const uploads = allFiles.filter((f) => !(f.meta && f.meta.request));
    const openRequests = allFiles.filter(
      (f) => f.meta && f.meta.request && f.status === "open",
    );
    const totalBytes = uploads.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const uploaderSet = new Set(
      uploads.map((f) => (f.meta && f.meta.account) || f.ip).filter(Boolean),
    );
    const sortedByExpiry = uploads
      .map((f) => Number(f.expires))
      .filter((e) => e > 0)
      .sort((a, b) => a - b);
    return {
      ok: true,
      roomid,
      fileCount: uploads.length,
      totalBytes,
      openRequestCount: openRequests.length,
      uniqueUploaders: uploaderSet.size,
      oldestExpiry: sortedByExpiry[0] || null,
    };
  }),
);

// GET /api/v1/metrics — process-level counters from observability.js
app.get(
  v1("/metrics"),
  requireAutomation("admin:read"),
  jroute(async () => {
    return { ok: true, metrics: OBS.snapshot() };
  }),
);

// GET /api/v1/audit — paginated automation audit log (admin:read scope)
app.get(
  v1("/audit"),
  requireAutomation("admin:read"),
  jroute(async (req) => {
    if (!AUTOMATION_AUDIT_LOG) {
      return {
        ok: true,
        entries: [],
        count: 0,
        note: "Audit log not configured",
      };
    }
    const limitParam = asPositiveInt(req.query.limit, 100, 1, 1000);
    const sinceParam = (req.query.since || "").toString().trim();
    const sinceTs = sinceParam ? new Date(sinceParam).getTime() : 0;
    let content;
    try {
      content = await require("fs").promises.readFile(
        AUTOMATION_AUDIT_LOG,
        "utf8",
      );
    } catch (ex) {
      if (ex.code === "ENOENT") {
        return { ok: true, entries: [], count: 0 };
      }
      throw ex;
    }
    const rawLines = content.trim().split("\n").filter(Boolean).reverse();
    const entries = [];
    for (const line of rawLines) {
      if (entries.length >= limitParam) break;
      try {
        const e = JSON.parse(line);
        if (sinceTs > 0) {
          const et = new Date(e.at).getTime();
          if (!Number.isFinite(et) || et <= sinceTs) break;
        }
        entries.push(e);
      } catch (_) {
        /* skip malformed lines */
      }
    }
    return { ok: true, entries, count: entries.length };
  }),
);

// POST /api/v1/batch-upload — accept [{url,name,roomid}], fetch and store each
app.post(
  v1("/batch-upload"),
  requireAutomation("uploads:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const items = req.body;
    if (!Array.isArray(items) || !items.length) {
      throw new Error(
        "body must be a non-empty JSON array of {url,name,roomid}",
      );
    }
    if (items.length > 20) {
      throw new Error("max 20 items per batch-upload request");
    }
    const SIZE_CAP = 100 * 1024 * 1024; // 100 MB per file
    const FETCH_TIMEOUT_MS = 60_000;
    const user = req.automationUser;
    const results = [];
    for (const item of items) {
      const itemUrl = ((item && item.url) || "").toString().trim();
      const itemName =
        ((item && item.name) || "").toString().trim() || "unnamed";
      const itemRoomid = ((item && item.roomid) || "").toString().trim();
      if (!itemUrl) {
        results.push({ url: itemUrl, err: "url is required" });
        continue;
      }
      if (!itemRoomid) {
        results.push({ url: itemUrl, err: "roomid is required" });
        continue;
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(itemUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol))
          throw new Error("scheme");
      } catch (_) {
        results.push({ url: itemUrl, err: "invalid url (http/https only)" });
        continue;
      }
      const itemRoom = await Room.get(itemRoomid);
      if (!itemRoom) {
        results.push({ url: itemUrl, err: "unknown room" });
        continue;
      }
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        let resp;
        try {
          resp = await fetch(itemUrl, { signal: ac.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!resp.ok) {
          results.push({ url: itemUrl, err: `fetch failed (${resp.status})` });
          continue;
        }
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of resp.body) {
          totalSize += chunk.length;
          if (totalSize > SIZE_CAP) {
            results.push({ url: itemUrl, err: "file exceeds 100 MB size cap" });
            break;
          }
          chunks.push(chunk);
        }
        if (totalSize > SIZE_CAP) continue;
        const buffer = Buffer.concat(chunks);
        const upload = await ingestFromBuffer({
          name: itemName,
          roomid: itemRoomid,
          buffer,
          ip: req.ip,
          user: user.name,
          account: user.account,
          role: user.role,
          ttl: itemRoom.fileTTL,
        });
        results.push({
          url: itemUrl,
          ok: true,
          key: upload.key,
          href: upload.href,
        });
      } catch (ex) {
        results.push({ url: itemUrl, err: ex.message || ex.toString() });
      }
    }
    return { ok: true, results };
  }),
);

// POST /api/v1/requests — (existing endpoint extended with hints support)
// hints support is handled in the existing /api/v1/requests handler below;
// see the updated call to REQUEST_EMITTER.createRequest.

// POST /api/v1/requests/:key/claim — agent claims a request with TTL
app.post(
  v1("/requests/:key/claim"),
  requireAutomation("requests:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const { key } = req.params;
    const ttlMs = asPositiveInt(
      req.body && req.body.ttlMs,
      300000,
      5000,
      3600000,
    );
    const agentId = req.automationKeyId;
    const updated = await REQUEST_EMITTER.claim(key, agentId, ttlMs);
    return { ok: true, request: updated.toClientJSON() };
  }),
);

// DELETE /api/v1/requests/:key/claim — agent releases a claimed request
app.delete(
  v1("/requests/:key/claim"),
  requireAutomation("requests:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async (req) => {
    const { key } = req.params;
    const agentId = req.automationKeyId;
    const updated = await REQUEST_EMITTER.release(key, agentId);
    return { ok: true, request: updated.toClientJSON() };
  }),
);

// Agent subscriptions — named server-side filter presets stored per API key
const _subRedis = BROKER.getMethods("hset", "hgetall", "hdel");

function subKey(apiKeyId) {
  return `agent:subs:${apiKeyId}`;
}

// POST /api/v1/agent/subscriptions — save (create/update) a named subscription
app.post(
  v1("/agent/subscriptions"),
  requireAutomation("files:read"),
  getAutomationUser,
  jroute(async (req) => {
    const body = req.body || {};
    const name = (body.name || "").toString().trim();
    if (!name || name.length > 60) {
      throw new Error("name is required and must be ≤60 chars");
    }
    // Build filter descriptor — mirrors the /api/v1/files query params
    const sub = {
      name,
      room: (body.room || "").toString().trim() || null,
      ext: Array.isArray(body.ext) ? body.ext.map(String).slice(0, 20) : [],
      name_contains: (body.name_contains || "").toString().trim() || null,
      max_size_mb: Number.isFinite(Number(body.max_size_mb))
        ? Number(body.max_size_mb)
        : null,
      type: (body.type || "").toString().trim() || null,
      createdAt: new Date().toISOString(),
    };
    await _subRedis.hset(
      subKey(req.automationKeyId),
      name,
      JSON.stringify(sub),
    );
    return { ok: true, subscription: sub };
  }),
);

// GET /api/v1/agent/subscriptions — list all subscriptions for this API key
app.get(
  v1("/agent/subscriptions"),
  requireAutomation("files:read"),
  jroute(async (req) => {
    const raw = await _subRedis.hgetall(subKey(req.automationKeyId));
    const subscriptions = raw
      ? Object.values(raw)
          .map((v) => {
            try {
              return JSON.parse(v);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];
    return { ok: true, subscriptions };
  }),
);

// DELETE /api/v1/agent/subscriptions/:name — remove a named subscription
app.delete(
  v1("/agent/subscriptions/:name"),
  requireAutomation("files:read"),
  jroute(async (req) => {
    const name = req.params.name;
    await _subRedis.hdel(subKey(req.automationKeyId), name);
    return { ok: true };
  }),
);

// ── End AI Automation API ─────────────────────────────────────────────────────

// ── Comic reader API ───────────────────────────────────────────────────────
// comicCheck resolves the upload and validates that it is a comic archive.
// Returns { up, storage } on success or sends an error response and returns null.
//
// Accepts files by meta.type OR by original filename extension (for backward
// compat with files uploaded before the CBZ-override fix).
async function comicCheck(req, res) {
  const { key } = req.params;
  const up = UPLOAD.resolve(key);
  if (!up) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const { storage } = up;
  const comicTypes = new Set(["CBZ", "CBR", "CBT"]);
  const storedType = (storage && storage.meta && storage.meta.type) || "";
  // Also accept by extension so files uploaded before the type-override fix work.
  const extType = /\.(cbz|cbr|cbt)$/i.exec(up.name || "");
  if (!storage || (!comicTypes.has(storedType) && !extType)) {
    res.status(400).json({ error: "Not a comic file" });
    return null;
  }
  // If the stored type was never fixed (e.g. RAR stored as "RAR" for a .cbz),
  // patch meta.type in-memory so downstream functions work correctly.
  if (!comicTypes.has(storedType) && extType) {
    storage.meta.type = extType[1].toUpperCase();
  }
  if (up.hidden) {
    const user = req.user;
    if (req.ip !== up.ip && (!user || user.role !== "mod")) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
  }
  return { up, storage };
}

// GET /api/v1/comic/:key/index
// Returns { pages, hash } so the client can cache by hash and paginate.
// Triggers on-demand index rebuild when comic_index is absent (e.g. initial
// asset generation was interrupted, or file was uploaded before this feature).
app.get(
  "/api/v1/comic/:key/index",
  getUser,
  aroute(async (req, res) => {
    const result = await comicCheck(req, res);
    if (!result) return;
    const { storage } = result;
    if (!storage.meta.comic_index) {
      try {
        await META.ensureComicAssets(storage);
      } catch (ex) {
        console.error("comic index rebuild failed:", ex.message);
      }
    }
    const pages = storage.meta.comic_index
      ? storage.meta.comic_index.split("\n").filter(Boolean).length
      : parseInt(storage.meta.pages, 10) || 0;
    res.json({ pages, hash: storage.hash });
  }),
);

// GET /api/v1/comic/:key/page/:n
// Returns the n-th page (0-indexed) as a JPEG, transcoded and rate-limited.
app.get(
  "/api/v1/comic/:key/page/:n",
  getUser,
  aroute(async (req, res) => {
    const result = await comicCheck(req, res);
    if (!result) return;
    const { up, storage } = result;
    const n = parseInt(req.params.n, 10);
    if (!isFinite(n) || n < 0) {
      res.status(400).json({ error: "Invalid page number" });
      return;
    }
    const imgBuf = await META.extractComicPage(storage, n);
    if (!imgBuf) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const ttl = Math.max(0, Math.floor((up.TTL || 0) / 1000));
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", `public, max-age=${ttl}`);
    res.end(imgBuf);
  }),
);
// ── End comic reader API ────────────────────────────────────────────────────

// ── Read-progress sync API ──────────────────────────────────────────────────
// Persists per-user, per-file reading position server-side so it survives
// browser-cache wipes and is shared across devices.
// Key: readprogress:<account>:<hash>  (TTL 365 days)
// Requires the requesting user to be logged in.

const _rpRedis = BROKER.getMethods("get", "set");
const RP_TTL = 365 * 24 * 3600; // 1 year in seconds

// GET /api/v1/readprogress/:hash
app.get(
  "/api/v1/readprogress/:hash",
  getUser,
  aroute(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ err: "Not logged in" });
    }
    const { hash } = req.params;
    if (!hash || !/^[a-fA-F0-9]{1,128}$/.test(hash)) {
      return res.status(400).json({ err: "Invalid hash" });
    }
    const key = `readprogress:${req.user.account}:${hash}`;
    const raw = await _rpRedis.get(key);
    if (!raw) {
      return res.json(null);
    }
    try {
      return res.json(JSON.parse(raw));
    } catch (_) {
      return res.json(null);
    }
  }),
);

// POST /api/v1/readprogress/:hash
// Body: { page?, chapter?, cfi?, percent?, ts? }
app.post(
  "/api/v1/readprogress/:hash",
  getUser,
  express.json({ limit: "2kb" }),
  aroute(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ err: "Not logged in" });
    }
    const { hash } = req.params;
    if (!hash || !/^[a-fA-F0-9]{1,128}$/.test(hash)) {
      return res.status(400).json({ err: "Invalid hash" });
    }
    const state = req.body;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return res.status(400).json({ err: "Invalid body" });
    }
    const key = `readprogress:${req.user.account}:${hash}`;
    await _rpRedis.set(key, JSON.stringify(state), "EX", RP_TTL);
    return res.json({ ok: true });
  }),
);
// ── End read-progress sync API ──────────────────────────────────────────────

app.get("/:page", (req, res, next) => {
  const { page } = req.params;
  if (PAGES.has(page)) {
    const pagename =
      page === "terms" ? "Terms of Service and Privacy Policy" : "The Rules";
    return render(res, page, { pagename });
  }
  return next();
});

// serve new favicon directory under /favicon
app.use("/favicon", ss(path.join(__dirname, "..", "favicon"), ss_opts));
// also make plain /favicon.ico resolve to the canonical file
app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "favicon", "favicon.ico"));
});

app.use("/", ss(p(), ss_opts));

// eslint-disable-next-line
app.all("*", (req, res, __) => {
  if (res.headerSent) {
    return;
  }
  res.status(404);
  render(res, "notfound", {
    pagename: "404",
  });
});

// eslint-disable-next-line
app.use(async (err, req, res, _) => {
  res.status(403);
  await render(res, "error", {
    pagename: "Error",
    error: err.message || err.toString(),
  });
});

function setupWS(server) {
  const io = sio(server, {
    path: "/w",
    transports: ["websocket"],
    serveClient: false,
    pingInterval: 10000,
    pingTimeout: 10000,
  });

  io.use(async (socket, next) => {
    socket.handshake.cookies = cookie.parse(
      socket.handshake.headers.cookie || "",
    );
    if (!socket.handshake.cookies.kft) {
      next(new Error("Invalid kft"));
      return;
    }
    const { roomid } = socket.handshake.query;
    socket.room = await Room.get(roomid);
    if (!socket.room) {
      next(new Error("Invalid room"));
      return;
    }
    if (socket.room.config.get("inviteonly")) {
      const user =
        socket.handshake.cookies.session &&
        (await User.load(socket.handshake.cookies.session));
      if (!user || user.role !== "mod") {
        const token = rtoken(socket.handshake);
        if (!socket.room.invited(user, token)) {
          next(new Error("You're not invited!"));
          return;
        }
      }
    }
    next();
  });

  io.on("connection", function (socket) {
    Client.create(socket, rtoken(socket.handshake));
  });
}

WEBHOOKS.install();

// Start the background preview-retry poller. Fires every 60 s and retries
// any uploads whose generateAssets call failed transiently.
require("./previewretry").start();

if (!CONFIG.get("tlsonly")) {
  const server = createServer(app);
  setupWS(server);
  server.listen(
    {
      port: CONFIG.get("port"),
      host: "0.0.0.0",
    },
    () => {
      console.log(
        `HTTP ${process.pid.toString().bold} is running on port ${CONFIG.get("port")}`,
      );
    },
  );
}

if (CONFIG.get("tls")) {
  const server = createTLSServer(
    {
      cert: fs.readFileSync(CONFIG.get("tlscert")),
      key: fs.readFileSync(CONFIG.get("tlskey")),
    },
    app,
  );
  setupWS(server);
  server.listen(
    {
      port: CONFIG.get("tlsport"),
      host: "0.0.0.0",
    },
    () => {
      console.log(
        `HTTPS ${process.pid.toString().bold} is running on port ${CONFIG.get("tlsport")}`,
      );
    },
  );
}
