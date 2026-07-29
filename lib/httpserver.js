"use strict";

const cookie = require("cookie");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
const REQUEST = require("./request");

const { EMITTER: REQUEST_EMITTER } = REQUEST;
const { StorageLocation, STORAGE } = require("./storage");
const {
  storageSnapshot,
  placementPreview,
  STORAGE_CONFIG,
} = require("./storage-volumes");
const { reservationTotals } = require("./storage-reservations");
const pkg = require("../package.json");
const { ingestFromBuffer } = require("./upload");

let sharp;
try {
  sharp = require("sharp");
}
catch (_) {
  sharp = null;
}
const { computeAchievements } = require("./achievements");
const { renderMarkdown } = require("./markdown");
const ARCHIVE = require("./archive");
const CONFIG = require("./config");
const WEBHOOKS = require("./webhooks");
const OBS = require("./observability");
const PUBLIC_STATUS = require("./public-status");
const STATUS_ACCESS = require("./status-access");
const { requireString } = require("./validate");
// BROKER is needed for distributed rate limiting and room messages.
const BROKER = require("./broker");
const {
  NAME,
  MOTTO,
  sekrit,
  hmactoken,
  rtoken,
  rtokenize,
  render,
  injectkft,
  getUser,
  aroute,
  requireMod,
  asArray,
  appendJSONLine,
  asPositiveInt,
  sendApiError,
  jroute,
  v1,
} = require("./http/helpers");
const {
  AUTOMATION_KEYS,
  AUTOMATION_RATE_STATE,
  AUTOMATION_RATE_MAX_ENTRIES,
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
} = require("./http/automation");
const {
  getRequiredRoom,
  listRoomLinks,
  createRoomLink,
  removeRoomLink,
  listFederatedRoomLinks,
  createFederatedRoomLink,
  removeFederatedRoomLink,
  updateRoomFederationPolicy,
  listGuestInvites,
  createGuestInvite,
  revokeGuestInvite,
  listRoomPlugins,
  upsertRoomPlugin,
  removeRoomPlugin,
  runRoomPlugin,
  inspectRoomPluginSyncMemory,
  clearRoomPluginSyncMemory,
} = require("./http/room-automation");
const {
  readFederationAudit,
  registerFederationRoutes,
} = require("./http/federation");
const {
  registerPluginInboundRoutes,
} = require("./http/plugin-inbound");
const {
  warmFederationCrypto,
} = require("./federation/signatures");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set(["terms", "rules"]);

const STTL = CONFIG.get("sessionTTL");

function validateRequestPayload(payload) {
  let text = "";
  let requestUrl = "";
  let requestImageDataUrl = "";
  if (payload && typeof payload === "object") {
    text = (payload.text || "").toString().trim();
    requestUrl = (payload.url || "").toString().trim();
    requestImageDataUrl = (payload.requestImage || "").toString().trim();
  }
  else {
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
    }
    catch (ex) {
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
registerFederationRoutes(app);
registerPluginInboundRoutes(app);

async function requireUploadRoomAccess(req, res, next) {
  const upload = UPLOAD.resolve(req.params.key);
  if (!upload) {
    next();
    return;
  }
  const room = await Room.get(upload.roomid);
  const protectedRoom = !!(
    room &&
    room.config.get("passwordAccess") &&
    room.config.get("passwordAccess").enabled
  );
  const automationKey = parseAutomationApiKey(req);
  const automationRecord =
    automationKey && AUTOMATION_KEYS.byKey.get(automationKey);
  const automationBypass = !!(
    automationRecord &&
    scopeAllowed(automationRecord.scopes, "room-access:bypass")
  );
  if (
    room &&
    !automationBypass &&
    !(await room.passwordAccessAllowed(req.user, rtoken(req), req.cookies))
  ) {
    res.status(403);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ error: "Room password required" });
    return;
  }
  if (protectedRoom) {
    req.roomPasswordProtected = true;
    res.setHeader("Cache-Control", "private, no-store");
  }
  next();
}

app.get(
  "/g/:key/:name",
  getUser,
  aroute(requireUploadRoomAccess),
  UPLOAD.serve,
);
app.get("/g/:key", getUser, aroute(requireUploadRoomAccess), UPLOAD.serve);

// A2A manifest endpoint (Agent‑to‑Agent discovery)
app.get("/.well-known/a2a", (req, res) => {
  const publicStatusEndpoints = STATUS_ACCESS.isStatusPagePrivate(CONFIG) ?
    [] :
    [{ path: "/api/public/status", scope: null }];
  res.json({
    ok: true,
    service: "Dicefiles",
    version: pkg.version || "1.0.0",
    baseUrl: "/api/v1",
    endpoints: [
      { path: "/api/v1/files", scope: "files:read" },
      { path: "/api/v1/rooms", scope: "rooms:write" },
      { path: "/api/v1/rooms/:id/links", scope: "room-links:read" },
      {
        path: "/api/v1/rooms/:id/federation-links",
        scope: "federation-links:read",
      },
      {
        path: "/api/v1/rooms/:id/guest-invites",
        scope: "guest-invites:read",
      },
      {
        path: "/api/v1/rooms/:id/plugins",
        scope: "room-plugins:read",
      },
      { path: "/healthz", scope: null },
      ...publicStatusEndpoints,
    ],
  });
});

app.get(
  "/healthz",
  aroute(async (req, res) => {
    const health = await OBS.health();
    res.status(health.ok ? 200 : 503);
    res.json(health);
  }),
);

app.get(
  "/api/public/status/:statusToken?",
  aroute(async (req, res) => {
    if (!STATUS_ACCESS.canAccessStatus(CONFIG, req.params.statusToken)) {
      res.status(404);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        error: {
          code: "NOT_FOUND",
          message: "Not found",
        },
      });
      return;
    }
    const status = await PUBLIC_STATUS.collect({ Room, UPLOAD, REQUEST });
    const cacheControl = STATUS_ACCESS.isStatusPagePrivate(CONFIG) ?
      "private, no-store" :
      `public, max-age=${PUBLIC_STATUS.SAMPLE_INTERVAL_SEC}, ` +
        "stale-while-revalidate=60";
    res.setHeader("Cache-Control", cacheControl);
    res.json(status);
  }),
);

app.use(injectkft);

// CSP
app.use(function (req, res, next) {
  // PDF.js runs with isEvalSupported=false, so the application does not need
  // to permit runtime code generation in browser scripts or its PDF worker.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' blob:; " +
      "style-src-elem 'self' 'unsafe-inline' blob: https://cdnjs.cloudflare.com; " +
      "font-src 'self' data: https://cdnjs.cloudflare.com; " +
      "img-src 'self' data: blob: https: http:; " +
      "media-src *; " +
      "connect-src 'self' https://api.giphy.com",
  );
  next();
});

app.get("/", async function (req, res) {
  if (CONFIG.get("publicRooms")) {
    try {
      const rooms = await Room.list();
      const publicRooms = rooms.filter(room => !room.passwordProtected);
      publicRooms.sort((a, b) => b.files - a.files);
      return render(res, "index", {
        v,
        publicRooms: true,
        rooms: publicRooms,
      });
    }
    catch (ex) {
      console.error("[home] failed to load room list:", ex.message);
    }
  }
  render(res, "index", { v });
});

app.get(
  "/status/:statusToken?",
  aroute(async function (req, res) {
    if (!STATUS_ACCESS.canAccessStatus(CONFIG, req.params.statusToken)) {
      res.status(404);
      render(res, "notfound", { pagename: "404" });
      return;
    }
    const status = await PUBLIC_STATUS.collect({ Room, UPLOAD, REQUEST });
    const privateStatus = STATUS_ACCESS.isStatusPagePrivate(CONFIG);
    res.setHeader(
      "Cache-Control",
      privateStatus ? "private, no-store" : "public, max-age=15",
    );
    render(res, "status", {
      pagename: "Service status",
      statusPage: true,
      statusApiHref: STATUS_ACCESS.statusApiHref(CONFIG, true),
      statusRefreshSec: PUBLIC_STATUS.SAMPLE_INTERVAL_SEC,
      status,
      statusJSON: JSON.stringify(status).replace(/</g, "\\u003c"),
    });
  }),
);

app.put("/api/upload/:key", getUser, UPLOAD.upload);

app.post("*", bodyParser.json());
app.patch("*", bodyParser.json());
app.delete("*", bodyParser.json());
app.use(logAutomationResponse);

app.post(
  v1("/auth/login"),
  requireAutomation("auth:login"),
  jroute(async req => {
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
  jroute(async req => {
    await User.logout(req.automationSession);
    return { ok: true };
  }),
);

function requireAutomationRoomAccess(req, room) {
  const protectedRoom = !!(
    room &&
    room.config.get("passwordAccess") &&
    room.config.get("passwordAccess").enabled
  );
  const scopes = new Set(req.automationKeyScopes || []);
  if (protectedRoom && !scopeAllowed(scopes, "room-access:bypass")) {
    const error = new Error(
      "Protected room access requires room-access:bypass",
    );
    error.status = 403;
    throw error;
  }
}

async function requireAutomationUploadAccess(req, upload) {
  if (!upload) {
    return;
  }
  const room = await Room.get(upload.roomid);
  requireAutomationRoomAccess(req, room);
}

app.post(
  v1("/rooms"),
  requireAutomation("rooms:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async req => {
    const room = await Room.create(req.ip, req.automationUser, rtoken(req));
    return {
      ok: true,
      roomid: room.roomid,
      href: `/r/${room.roomid}`,
    };
  }),
);

app.get(
  v1("/rooms/:id/links"),
  requireAutomation("room-links:read"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return listRoomLinks(room);
  }),
);

app.post(
  v1("/rooms/:id/links"),
  requireAutomation("room-links:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return createRoomLink(room, req.body);
  }),
);

app.delete(
  v1("/rooms/:id/links/:sourceRoomId"),
  requireAutomation("room-links:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return removeRoomLink(room, req.params.sourceRoomId);
  }),
);

app.get(
  v1("/rooms/:id/federation-links"),
  requireAutomation("federation-links:read"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return listFederatedRoomLinks(room);
  }),
);

app.post(
  v1("/rooms/:id/federation-links"),
  requireAutomation("federation-links:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return createFederatedRoomLink(room, req.body);
  }),
);

app.delete(
  v1("/rooms/:id/federation-links/:peerId/:remoteRoomId"),
  requireAutomation("federation-links:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return removeFederatedRoomLink(
      room,
      req.params.peerId,
      req.params.remoteRoomId,
    );
  }),
);

app.patch(
  v1("/rooms/:id/federation"),
  requireAutomation("federation-links:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return updateRoomFederationPolicy(room, req.body);
  }),
);

app.get(
  v1("/rooms/:id/guest-invites"),
  requireAutomation("guest-invites:read"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return listGuestInvites(room);
  }),
);

app.post(
  v1("/rooms/:id/guest-invites"),
  requireAutomation("guest-invites:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return createGuestInvite(room, req.body, `api:${req.automationKeyId}`);
  }),
);

app.delete(
  v1("/rooms/:id/guest-invites/:token"),
  requireAutomation("guest-invites:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return revokeGuestInvite(
      room,
      req.params.token,
      `api:${req.automationKeyId}`,
    );
  }),
);

app.get(
  v1("/rooms/:id/plugins"),
  requireAutomation("room-plugins:read"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return listRoomPlugins(room);
  }),
);

app.put(
  v1("/rooms/:id/plugins/:pluginId"),
  requireAutomation("room-plugins:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return upsertRoomPlugin(room, req.params.pluginId, req.body);
  }),
);

app.delete(
  v1("/rooms/:id/plugins/:pluginId"),
  requireAutomation("room-plugins:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return removeRoomPlugin(room, req.params.pluginId);
  }),
);

app.post(
  v1("/rooms/:id/plugins/:pluginId/run"),
  requireAutomation("room-plugins:run"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return runRoomPlugin(room, req.params.pluginId);
  }),
);

app.get(
  v1("/rooms/:id/plugins/:pluginId/sync-log"),
  requireAutomation("room-plugins:read"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return inspectRoomPluginSyncMemory(
      room,
      req.params.pluginId,
      req.query,
    );
  }),
);

app.delete(
  v1("/rooms/:id/plugins/:pluginId/sync-log"),
  requireAutomation("room-plugins:write"),
  jroute(async req => {
    const room = await getRequiredRoom(Room, req.params.id);
    return clearRoomPluginSyncMemory(
      room,
      req.params.pluginId,
      req.body,
    );
  }),
);

function withoutRoomPasswords(state) {
  if (!state || typeof state !== "object") {
    return state;
  }
  const output = Object.assign({}, state);
  delete output.currentPassword;
  delete output.nextPassword;
  return output;
}

app.get(
  v1("/rooms/:id/password-access"),
  requireAutomation("room-access:read"),
  jroute(async req => {
    req.res.setHeader("Cache-Control", "private, no-store");
    const room = await getRequiredRoom(Room, req.params.id);
    return {
      ok: true,
      access: withoutRoomPasswords(
        await room.getPasswordAccessAdminState(false),
      ),
    };
  }),
);

app.get(
  v1("/rooms/:id/password-access/secrets"),
  requireAutomation("room-access:secrets"),
  jroute(async req => {
    req.res.setHeader("Cache-Control", "private, no-store");
    const room = await getRequiredRoom(Room, req.params.id);
    return {
      ok: true,
      access: await room.getPasswordAccessAdminState(true),
    };
  }),
);

app.patch(
  v1("/rooms/:id/password-access"),
  requireAutomation("room-access:write"),
  jroute(async req => {
    req.res.setHeader("Cache-Control", "private, no-store");
    const room = await getRequiredRoom(Room, req.params.id);
    return {
      ok: true,
      access: withoutRoomPasswords(
        await room.configurePasswordAccess(req.body || {}),
      ),
    };
  }),
);

app.post(
  v1("/rooms/:id/password-access/rotate"),
  requireAutomation("room-access:write"),
  jroute(async req => {
    req.res.setHeader("Cache-Control", "private, no-store");
    const room = await getRequiredRoom(Room, req.params.id);
    return {
      ok: true,
      access: withoutRoomPasswords(
        await room.rotatePasswordAccess(req.body || {}),
      ),
    };
  }),
);

app.get(
  v1("/admin/storage"),
  requireAutomation("admin:read"),
  jroute(async () => {
    const reserved = await reservationTotals();
    return {
      ok: true,
      policy: STORAGE_CONFIG.policy,
      fallbackThreshold: STORAGE_CONFIG.fallbackThreshold,
      volumes: storageSnapshot(reserved),
    };
  }),
);

app.post(
  v1("/admin/storage/placement-preview"),
  requireAutomation("admin:read"),
  jroute(async req => {
    const reserved = await reservationTotals();
    return {
      ok: true,
      placement: placementPreview(
        req.body && Math.max(0, Number(req.body.bytes) || 0),
        reserved,
      ),
    };
  }),
);

app.post(
  v1("/requests"),
  requireAutomation("requests:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async req => {
    const { roomid } = req.body || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
    const { text, requestUrl, requestImageDataUrl } = validateRequestPayload(
      req.body,
    );
    const hintsRaw = req.body && req.body.hints;
    const hints =
      hintsRaw && typeof hintsRaw === "object" && !Array.isArray(hintsRaw) ?
        hintsRaw :
        {};
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
    await user.addCreatedRequest();
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
  jroute(async req => {
    const { roomid } = req.body || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
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
  jroute(async req => {
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
  jroute(async req => {
    const { roomid } = req.query || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
    const role = req.automationUser ? req.automationUser.role : "white";
    const files = await room.getFilesFor({
      role,
      ip: req.ip,
      user: req.automationUser,
      token: "",
    });
    const since = parseInt(req.query.since, 10);
    const type = (req.query.type || "all").toString();

    let filtered = files;
    if (type === "uploads") {
      filtered = filtered.filter(f => !(f.meta && f.meta.request));
    }
    else if (type === "requests") {
      filtered = filtered.filter(f => f.meta && f.meta.request);
    }
    else if (type === "new") {
      if (!isFinite(since) || since <= 0) {
        throw new Error("since is required for type=new");
      }
      filtered = filtered.filter(f => Number(f.uploaded) > since);
    }
    else if (type !== "all") {
      throw new Error("Invalid type; expected all|uploads|requests|new");
    }

    // Optional name / extension filters (case-insensitive)
    const nameContains = (req.query.name_contains || "").
      toString().
      trim().
      toLowerCase();
    const extParam = (req.query.ext || "").toString().trim().toLowerCase();
    const extList = extParam ?
      extParam.split(",").map(e => e.replace(/^\./, "")) :
      [];
    if (nameContains) {
      filtered = filtered.filter(f =>
        (f.name || "").toLowerCase().includes(nameContains),
      );
    }
    if (extList.length) {
      filtered = filtered.filter(f => {
        const dot = (f.name || "").lastIndexOf(".");
        const fileExt = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
        return extList.includes(fileExt);
      });
    }

    return {
      ok: true,
      roomid,
      count: filtered.length,
      files: filtered.map(f =>
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
  jroute(async req => {
    const { roomid } = req.query || {};
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
    const role = req.automationUser ? req.automationUser.role : "white";
    const files = await room.files.for(role, req.ip);
    const since = parseInt(req.query.since, 10);
    const scope = (req.query.scope || "all").toString();
    let downloads = files.filter(f => !(f.meta && f.meta.request));
    if (scope === "new") {
      if (!isFinite(since) || since <= 0) {
        throw new Error("since is required for scope=new");
      }
      downloads = downloads.filter(f => Number(f.uploaded) > since);
    }
    else if (scope !== "all") {
      throw new Error("Invalid scope; expected all|new");
    }

    // Optional name / extension filters (case-insensitive)
    const nameContains = (req.query.name_contains || "").
      toString().
      trim().
      toLowerCase();
    const extParam = (req.query.ext || "").toString().trim().toLowerCase();
    const extList = extParam ?
      extParam.split(",").map(e => e.replace(/^\./, "")) :
      [];
    if (nameContains) {
      downloads = downloads.filter(f =>
        (f.name || "").toLowerCase().includes(nameContains),
      );
    }
    if (extList.length) {
      downloads = downloads.filter(f => {
        const dot = (f.name || "").lastIndexOf(".");
        const fileExt = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
        return extList.includes(fileExt);
      });
    }
    return {
      ok: true,
      roomid,
      count: downloads.length,
      files: downloads.map(f => ({
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
  jroute(async req => {
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
    requireAutomationRoomAccess(req, room);
    const user = req.automationUser;
    let removed = 0;
    if (user.role === "mod" || room.owns(user.account, rtoken(req))) {
      removed = await room.trash(keys);
    }
    else {
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

const roomPasswordRateLimit = BROKER.getMethods("ratelimit");

async function checkRoomPasswordRate(req, roomid) {
  const defaults = CONFIG.get("roomPasswordAccess") || {};
  const max = Math.max(
    1,
    Math.min(100, Number(defaults.maxAttemptsPerMinute) || 10),
  );
  const identity = crypto.
    createHmac("sha256", sekrit).
    update(`${roomid}:${req.ip || ""}`).
    digest("base64url");
  const [count, ttlMs] = await roomPasswordRateLimit.ratelimit(
    `rl:room-password:${identity}`,
    60000,
  );
  return {
    limited: Number(count) > max,
    retryAfterSec: Math.max(1, Math.ceil((Number(ttlMs) || 60000) / 1000)),
  };
}

app.post(
  "/r/:roomid/access",
  bodyParser.urlencoded({ extended: false, limit: "16kb" }),
  aroute(async function (req, res, next) {
    const room = await Room.get(req.params.roomid);
    if (!room) {
      next();
      return;
    }
    if (req.body.token !== rtoken(req)) {
      res.status(403);
      render(res, "room-access", {
        pagename: "Protected room",
        roomid: room.roomid,
        error: "This access form expired. Please try again.",
      });
      return;
    }
    const rate = await checkRoomPasswordRate(req, room.roomid);
    if (rate.limited) {
      res.status(429);
      res.setHeader("Retry-After", rate.retryAfterSec);
      render(res, "room-access", {
        pagename: "Protected room",
        roomid: room.roomid,
        error: "Too many attempts. Wait a moment before trying again.",
      });
      return;
    }
    const grant = await room.authenticatePasswordAccess(
      req.body.password,
      rtoken(req),
    );
    if (!grant) {
      res.status(401);
      render(res, "room-access", {
        pagename: "Protected room",
        roomid: room.roomid,
        error: "That room password is not valid.",
      });
      return;
    }
    res.cookie(grant.name, grant.value, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "Strict",
      expires: grant.expires,
    });
    res.redirect(303, `/r/${room.roomid}`);
  }),
);

app.post(
  "/api/changepw",
  rtokenize(async req => {
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
  rtokenize(async req => {
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
        const guestInvite =
          (req.query && (req.query.invite || req.query.guestInvite)) || "";
        if (!room.invited(req.user, token, guestInvite)) {
          next(new Error("You're not invited!"));
          return;
        }
        // First successful entry with a guest invite link burns one use
        // and grants a guest pass for this browser token.
        if (guestInvite && !room.hasGuestPass(token)) {
          const redeemed = room.redeemGuestInviteToken(guestInvite, token);
          if (!redeemed.ok && !room.hasGuestPass(token)) {
            next(new Error("Invite link is invalid or exhausted"));
            return;
          }
        }
      }
    }
    if (
      !(await room.passwordAccessAllowed(req.user, rtoken(req), req.cookies))
    ) {
      res.status(401);
      res.setHeader("Cache-Control", "private, no-store");
      render(res, "room-access", {
        pagename: "Protected room",
        roomid: room.roomid,
        error: "",
      });
      return;
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
    info.lookingHtml = renderMarkdown(user.looking || "");
    info.activity =
      CONFIG.get("profileActivity") !== false ? await user.getActivity() : null;
    info.canEditMessage = !!(req.user && req.user.account === user.account);
    render(res, "user", {
      pagename: `User ${user.name}`,
      user,
      info,
    });
  }),
);

app.all(
  "/account",
  aroute(async function (req, res, next) {
    const { user } = req;
    if (!user) {
      next(new Error("You are not logged in!"));
      return;
    }
    const info = await user.getInfo();
    render(res, "account", {
      pagename: "Your Account",
      user,
      achievements: computeAchievements(info.uploadStats),
    });
  }),
);

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
    }
    catch (ex) {
      console.error(ex);
      next();
    }
  }),
);

app.get(
  "/adiscover",
  aroute(async (req, res) => {
    requireMod(req);
    const rooms = (await Room.list()).filter(r => r.users || r.files);
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
      record.files.forEach(f => {
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
  jroute(async req => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    await requireAutomationUploadAccess(req, up);
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
  jroute(async req => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    await requireAutomationUploadAccess(req, up);
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
  jroute(async req => {
    const up = UPLOAD.resolve(req.params.key);
    if (!up) {
      throw Object.assign(new Error("File not found"), { status: 404 });
    }
    await requireAutomationUploadAccess(req, up);
    const { body } = req;
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
  jroute(async req => {
    const roomid = req.params.id;
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
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
  jroute(async req => {
    const roomid = req.params.id;
    const room = await Room.get(roomid);
    if (!room) {
      throw new Error("Unknown room");
    }
    requireAutomationRoomAccess(req, room);
    const allFiles = await room.files.for("mod", "");
    const uploads = allFiles.filter(f => !(f.meta && f.meta.request));
    const openRequests = allFiles.filter(
      f => f.meta && f.meta.request && f.status === "open",
    );
    const totalBytes = uploads.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const uploaderSet = new Set(
      uploads.map(f => (f.meta && f.meta.account) || f.ip).filter(Boolean),
    );
    const sortedByExpiry = uploads.
      map(f => Number(f.expires)).
      filter(e => e > 0).
      sort((a, b) => a - b);
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
  jroute(() => {
    return { ok: true, metrics: OBS.snapshot() };
  }),
);

app.get(
  v1("/federation/peers"),
  requireAutomation("admin:read"),
  jroute(async () => {
    const {
      currentConfig,
      listPeerStatuses,
    } = require("./federation/transport");

    const federation = currentConfig();
    return {
      ok: true,
      enabled: federation.enabled,
      peerId: federation.peerId || null,
      key: federation.enabled ? {
        keyId: federation.keyId,
        fingerprint:
          federation.publicKeyJwk ?
            require("./federation/identity").publicFingerprint(
              federation.publicKeyJwk,
            ) :
            null,
        pending: federation.pendingPublicKey,
      } : null,
      peers: await listPeerStatuses(),
    };
  }),
);

app.get(
  v1("/federation/audit"),
  requireAutomation("admin:read"),
  jroute(async req => {
    const limit = asPositiveInt(req.query.limit, 100, 1, 1000);
    const entries = await readFederationAudit(limit);
    return { ok: true, count: entries.length, entries };
  }),
);

// GET /api/v1/audit — paginated automation audit log (admin:read scope)
app.get(
  v1("/audit"),
  requireAutomation("admin:read"),
  jroute(async req => {
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
    }
    catch (ex) {
      if (ex.code === "ENOENT") {
        return { ok: true, entries: [], count: 0 };
      }
      throw ex;
    }
    const rawLines = content.trim().split("\n").filter(Boolean).reverse();
    const entries = [];
    for (const line of rawLines) {
      if (entries.length >= limitParam) {
        break;
      }
      try {
        const e = JSON.parse(line);
        if (sinceTs > 0) {
          const et = new Date(e.at).getTime();
          if (!Number.isFinite(et) || et <= sinceTs) {
            break;
          }
        }
        entries.push(e);
      }
      catch (_) {
        /* skip malformed lines */
      }
    }
    return { ok: true, entries, count: entries.length };
  }),
);

// ─── Admin: remote config management (admin:config scope) ────────────────────
// These keys are safe to mutate at runtime without a server restart.
// Keys controlling listen port, TLS, secret, or worker count are intentionally
// excluded because changing them in-memory has no meaningful effect.
const ADMIN_CONFIG_WHITELIST = new Set([
  "publicRooms",
  "roomPruning",
  "roomPruningDays",
  "roomCreation",
  "roomCreationRequiresAccount",
  "requireAccounts",
  "allowRequests",
  "linkCollection",
  "profileActivity",
  "newRoomMemberDays",
  "maxFileSize",
  "TTL",
  "downloadMaxConcurrent",
  "chatFloodTrigger",
  "chatFloodDuration",
  "uploadFloodTrigger",
  "uploadFloodDuration",
  "name",
  "motto",
  // opengraphIoKey intentionally excluded — third-party API keys must not be
  // returned by the admin config endpoint to prevent accidental exposure.
]);

// GET /api/v1/admin/config — return all runtime-mutable config values
app.get(
  v1("/admin/config"),
  requireAutomation("admin:config"),
  jroute(() => {
    const cfg = {};
    for (const key of ADMIN_CONFIG_WHITELIST) {
      cfg[key] = CONFIG.get(key);
    }
    return { ok: true, config: cfg };
  }),
);

// PATCH /api/v1/admin/config — update one or more runtime-mutable config keys.
// Optionally persists changes to .config.json with { persist: true }.
app.patch(
  v1("/admin/config"),
  requireAutomation("admin:config"),
  jroute(async req => {
    const body = req.body || {};
    const { persist = false, ...updates } = body;
    const applied = {};
    const rejected = {};

    for (const [key, value] of Object.entries(updates)) {
      if (!ADMIN_CONFIG_WHITELIST.has(key)) {
        rejected[key] = "key not runtime-mutable";
        continue;
      }
      CONFIG.set(key, value);
      applied[key] = value;
    }

    if (persist && Object.keys(applied).length) {
      const configPath = path.join(process.cwd(), ".config.json");
      let existing = {};
      try {
        existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
      }
      catch (_) {
        // File may not exist yet; start from empty object.
      }
      Object.assign(existing, applied);
      fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`);
    }

    return {
      ok: true,
      applied,
      rejected: Object.keys(rejected).length ? rejected : undefined,
      persisted: persist && Object.keys(applied).length > 0,
    };
  }),
);

// ─── Admin: room management (admin:rooms scope) ───────────────────────────────

// POST /api/v1/admin/rooms/prune — force a prune pass regardless of schedule.
// Returns the number of rooms destroyed.
app.post(
  v1("/admin/rooms/prune"),
  requireAutomation("admin:rooms"),
  jroute(async () => {
    const pruned = await Room.prune();
    return { ok: true, pruned };
  }),
);

// DELETE /api/v1/admin/rooms/:id — permanently destroy a single room.
app.delete(
  v1("/admin/rooms/:id"),
  requireAutomation("admin:rooms"),
  jroute(async (req, res) => {
    const roomid = (req.params.id || "").toString().trim();
    if (!roomid) {
      throw new Error("roomid is required");
    }
    const room = await Room.get(roomid);
    if (!room) {
      return sendApiError(res, 404, "Room not found");
    }
    await Room.destroy(roomid);
    return { ok: true, roomid };
  }),
);

// DELETE /api/v1/admin/rooms — nuclear option: destroy ALL rooms.
// Requires explicit confirmation: body must contain { confirm: "destroy-all-rooms" }.
app.delete(
  v1("/admin/rooms"),
  requireAutomation("admin:rooms"),
  jroute(async req => {
    const confirm = (req.body && req.body.confirm) || "";
    if (confirm !== "destroy-all-rooms") {
      throw new Error(
        "Destructive action requires body { \"confirm\": \"destroy-all-rooms\" }",
      );
    }
    const allRooms = await Room.list();
    let destroyed = 0;
    for (const { roomid } of allRooms) {
      try {
        await Room.destroy(roomid);
        destroyed++;
      }
      catch (ex) {
        console.error(`[admin] Failed to destroy room ${roomid}:`, ex.message);
      }
    }
    return { ok: true, destroyed };
  }),
);

// POST /api/v1/batch-upload — accept [{url,name,roomid}], fetch and store each
app.post(
  v1("/batch-upload"),
  requireAutomation("uploads:write"),
  getAutomationUser,
  requireAutomationUser,
  jroute(async req => {
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
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("scheme");
        }
      }
      catch (_) {
        results.push({ url: itemUrl, err: "invalid url (http/https only)" });
        continue;
      }
      const itemRoom = await Room.get(itemRoomid);
      if (!itemRoom) {
        results.push({ url: itemUrl, err: "unknown room" });
        continue;
      }
      try {
        requireAutomationRoomAccess(req, itemRoom);
      }
      catch (error) {
        results.push({ url: itemUrl, err: error.message });
        continue;
      }
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        let resp;
        try {
          resp = await fetch(itemUrl, { signal: ac.signal });
        }
        finally {
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
        if (totalSize > SIZE_CAP) {
          continue;
        }
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
      }
      catch (ex) {
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
  jroute(async req => {
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
  jroute(async req => {
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
  jroute(async req => {
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
      max_size_mb: Number.isFinite(Number(body.max_size_mb)) ?
        Number(body.max_size_mb) :
        null,
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
  jroute(async req => {
    const raw = await _subRedis.hgetall(subKey(req.automationKeyId));
    const subscriptions = raw ?
      Object.values(raw).
        map(v => {
          try {
            return JSON.parse(v);
          }
          catch {
            return null;
          }
        }).
        filter(Boolean) :
      [];
    return { ok: true, subscriptions };
  }),
);

// DELETE /api/v1/agent/subscriptions/:name — remove a named subscription
app.delete(
  v1("/agent/subscriptions/:name"),
  requireAutomation("files:read"),
  jroute(async req => {
    const { name } = req.params;
    await _subRedis.hdel(subKey(req.automationKeyId), name);
    return { ok: true };
  }),
);

// ── End AI Automation API ─────────────────────────────────────────────────────

// ── Archive viewer API ─────────────────────────────────────────────────────
app.use(
  ["/api/v1/archive/:key", "/api/v1/comic/:key"],
  getUser,
  aroute(requireUploadRoomAccess),
);

// archiveCheck resolves the upload and validates it is a browsable archive.
// Returns { up, storage } on success, or sends an error response and returns null.
function archiveCheck(req, res) {
  const { key } = req.params;
  const up = UPLOAD.resolve(key);
  if (!up) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const { storage } = up;
  if (!storage) {
    res.status(404).json({ error: "Storage not found" });
    return null;
  }
  if (!ARCHIVE.isViewableArchive(up)) {
    res.status(400).json({ error: "Not a browsable archive" });
    return null;
  }
  if (up.hidden) {
    const { user } = req;
    if (req.ip !== up.ip && (!user || user.role !== "mod")) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
  }
  return { up, storage };
}

// GET /api/v1/archive/:key/ls
// Returns JSON { format, files: [{ path, size, isDir }] }
app.get(
  "/api/v1/archive/:key/ls",
  getUser,
  aroute(async (req, res) => {
    const result = archiveCheck(req, res);
    if (!result) {
      return;
    }
    const { up, storage } = result;
    const listing = await ARCHIVE.listArchive(storage.full, up.name || "");
    res.json(listing);
  }),
);

// GET /api/v1/archive/:key/file?path=<urlencoded-entry-path>
// Streams the decompressed bytes with download Content-Disposition.
app.get(
  "/api/v1/archive/:key/file",
  getUser,
  aroute(async (req, res) => {
    const result = archiveCheck(req, res);
    if (!result) {
      return;
    }
    const { up, storage } = result;
    const entryPath = (req.query.path || "").toString();
    if (!entryPath) {
      res.status(400).json({ error: "Missing path parameter" });
      return;
    }

    let buf;
    try {
      buf = await ARCHIVE.extractEntry(storage.full, up.name || "", entryPath);
    }
    catch (ex) {
      const status = (ex && ex.status) || 500;
      res.status(status).json({ error: ex.message || "Extraction failed" });
      return;
    }

    const basename =
      path.basename(entryPath).replace(/[^\x20-\x7e]/g, "_") || "file";
    const ttl = Math.max(0, Math.floor((up.TTL || 0) / 1000));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename}"; filename*=UTF-8''${encodeURIComponent(basename)}`,
    );
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Cache-Control",
      req.roomPasswordProtected ?
        "private, no-store" :
        `public, max-age=${ttl}`,
    );
    res.end(buf);
  }),
);
// ── End archive viewer API ─────────────────────────────────────────────────

// ── Comic reader API ───────────────────────────────────────────────────────
// comicCheck resolves the upload and validates that it is a comic archive.
// Returns { up, storage } on success or sends an error response and returns null.
//
// Accepts files by meta.type OR by original filename extension (for backward
// compat with files uploaded before the CBZ-override fix).
function comicCheck(req, res) {
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
    const { user } = req;
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
    if (!result) {
      return;
    }
    const { storage } = result;
    if (!storage.meta.comic_index) {
      try {
        await META.ensureComicAssets(storage);
      }
      catch (ex) {
        console.error("comic index rebuild failed:", ex.message);
      }
    }
    const pages = storage.meta.comic_index ?
      storage.meta.comic_index.split("\n").filter(Boolean).length :
      parseInt(storage.meta.pages, 10) || 0;
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
    if (!result) {
      return;
    }
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

const { setupWS: bindWS } = require("./http/ws");

function setupWS(server) {
  return bindWS(server, { Room, User, Client, rtoken });
}

WEBHOOKS.install();
PUBLIC_STATUS.startSampler({ Room, UPLOAD, REQUEST });
require("./federation/outbox").defaultFederationOutbox.start();

// First-party plugins (Mega.nz folder import, …) — see core/plugins/
try {
  const { defaultRegistry } = require("./plugins/registry");
  const { buildPluginRuntimeCtx } = require("./plugins/runtime-adapters");

  const pluginCfg = CONFIG.get("plugins") || [];
  const { loaded, errors } = defaultRegistry.loadFromConfig(pluginCfg);
  if (errors.length) {
    for (const e of errors) {
      console.warn(`[plugins] failed to load ${e.id}: ${e.error}`);
    }
  }
  if (loaded.length) {
    console.log(`[plugins] loaded: ${loaded.join(", ")}`);
  }
  const { defaultRoomPluginRuntime } = require("./plugins/room-runtime");

  const runtime = buildPluginRuntimeCtx({
    scheduleRun(id, args) {
      // Deferred run to avoid re-entrancy on hot event paths
      setImmediate(() => {
        defaultRegistry.run(id, args).catch(ex => {
          console.error(`[plugins] run ${id}`, ex);
        });
      });
    },
  });
  defaultRoomPluginRuntime.setSharedCtx(runtime);
  if (runtime.megaDownloader && runtime.megaDownloader.sdkAvailable) {
    console.log(
      `[plugins] megaDownloader SDK: ${runtime.megaDownloader.sdkName}`,
    );
  }
  else {
    console.log(
      "[plugins] megaDownloader: megajs not installed (yarn add megajs for live Mega.nz sync)",
    );
  }
  defaultRegistry.
    startAll(runtime).
    catch(ex => console.error("[plugins] startAll", ex));
  console.log(
    `[plugins] room bot catalog: ${defaultRoomPluginRuntime.
      listCatalog().
      map(c => c.id).
      join(", ") || "(none)"}`,
  );
}
catch (ex) {
  console.warn("[plugins] bootstrap skipped", ex.message || ex);
}

// Start the background preview-retry poller. Fires every 60 s and retries
// any uploads whose generateAssets call failed transiently.
require("./previewretry").start();

async function listenServers() {
  const federation = CONFIG.get("federation");
  if (federation && federation.enabled === true) {
    const started = Date.now();
    await warmFederationCrypto(federation);
    console.log(
      `[federation] signing runtime ready in ${Date.now() - started}ms`,
    );
  }

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
}

listenServers().catch(error => {
  console.error(
    "[startup] HTTP server initialization failed",
    error && error.stack || error,
  );
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});
