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
const { EMITTER: REQUEST_EMITTER } = require("./request");
const { computeAchievements } = require("./achievements");
const { renderMarkdown } = require("./markdown");
const CONFIG = require("./config");
const WEBHOOKS = require("./webhooks");
const OBS = require("./observability");

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
    "files:delete",
    "rooms:write",
    "uploads:write",
    "requests:write",
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
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of AUTOMATION_RATE_STATE.entries()) {
      if (!v || now >= v.resetAt + 10 * 60 * 1000) {
        AUTOMATION_RATE_STATE.delete(k);
      }
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

function checkAutomationRateLimit(keyId, scope) {
  const limit = rateLimitForScope(scope);
  const bucketKey = `${keyId}|${scope || "*"}`;
  const now = Date.now();
  let state = AUTOMATION_RATE_STATE.get(bucketKey);
  if (!state || now >= state.resetAt) {
    state = {
      count: 0,
      resetAt: now + limit.windowMs,
    };
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
  return function (req, res, next) {
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
    const rate = checkAutomationRateLimit(record.id, scope || "*");
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
  require("helmet")({
    hsts: {
      setIf(req) {
        return req.secure;
      },
    },
    xssFilter: false,
    ieNoOpen: false,
  }),
);

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
    const { u, p } = req.body;
    if (!u || !p) {
      throw new Error("Invalid call");
    }
    const rv = await User.create(req.ip, u, p);
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
    const { u, p, t } = req.body;
    if (!u || !p) {
      throw new Error("Invalid call");
    }
    const rv = await User.login(req.ip, u, p, t);
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

    const { c, p, t } = req.body;
    if (!c || !p) {
      throw new Error("Invalid call");
    }

    const rv = await user.changePassword(req.ip, c, p, t);
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

app.get("/:page", (req, res, next) => {
  const { page } = req.params;
  if (PAGES.has(page)) {
    const pagename =
      page === "terms" ? "Terms of Service and Privacy Policy" : "The Rules";
    return render(res, page, { pagename });
  }
  return next();
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
