"use strict";

const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const CONFIG = require("../config");
const BROKER = require("../broker");
const { Room } = require("../room");
const UPLOAD = require("../upload");
const pkg = require("../../package.json");
const {
  normalizeFederationConfig,
  peerAllowsRoom,
} = require("../federation/config");
const {
  publicFingerprint,
} = require("../federation/identity");
const {
  verifyFederationRequest,
} = require("../federation/signatures");
const {
  invalidateRemoteRoom,
  proxyRemoteFile,
} = require("../federation/transport");
const {
  federationRuleFile,
  normalizeFederatedRoomLinks,
  requestedFederationRules,
} = require("../federation/links");
const {
  fileMatchesLinkRules,
  linkVisibilityAllows,
} = require("../room/room-links");
const {
  getUser,
  rtoken,
} = require("./helpers");

const PROTOCOL_VERSION = "1.0";
const federationRedis = BROKER.getMethods("incr", "expire");

function config() {
  return normalizeFederationConfig(
    CONFIG.get("federation"),
    CONFIG.get("publicBaseUrl"),
  );
}

function requestId(req) {
  const supplied = String(req.get("x-request-id") || "").trim();
  return supplied && supplied.length <= 100 ?
    supplied :
    crypto.randomUUID();
}

function federationError(res, status, code, message, id) {
  res.status(status).json({
    error: {
      code,
      message,
      requestId: id,
    },
  });
}

function appendFederationAudit(current, payload) {
  if (!current.auditLog) {
    return;
  }
  const target = path.isAbsolute(current.auditLog) ?
    current.auditLog :
    path.join(process.cwd(), current.auditLog);
  fs.appendFile(
    target,
    `${JSON.stringify(Object.assign({ at: new Date().toISOString() }, payload))}\n`,
    () => {},
  );
}

async function readFederationAudit(limit = 100) {
  const current = config();
  if (!current.auditLog) {
    return [];
  }
  const target = path.isAbsolute(current.auditLog) ?
    current.auditLog :
    path.join(process.cwd(), current.auditLog);
  let content;
  try {
    content = await fs.promises.readFile(target, "utf8");
  }
  catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const max = Math.max(1, Math.min(1000, Number(limit) || 100));
  return content.
    trim().
    split("\n").
    filter(Boolean).
    reverse().
    slice(0, max).
    map(line => {
      try {
        const entry = JSON.parse(line);
        return {
          at: String(entry.at || ""),
          requestId: String(entry.requestId || ""),
          peerId: entry.peerId == null ? null : String(entry.peerId),
          method: String(entry.method || ""),
          path: String(entry.path || ""),
          status: Number(entry.status) || 0,
          code: String(entry.code || ""),
        };
      }
      catch (_) {
        return null;
      }
    }).
    filter(Boolean);
}

function keyId(current) {
  return current.keyId ||
    `${current.publicBaseUrl}/federation/actor#main-key`;
}

function discoveryDocument(current) {
  return {
    protocol: "dicefiles-federation",
    protocolVersion: PROTOCOL_VERSION,
    peerId: current.peerId,
    displayName: current.displayName,
    origin: current.publicBaseUrl,
    software: { name: "Dicefiles", version: pkg.version },
    actor: `${current.publicBaseUrl}/federation/actor`,
    key: {
      id: keyId(current),
      algorithm: "rsa-v1_5-sha256",
      publicKeyJwk: current.publicKeyJwk,
      fingerprint: publicFingerprint(current.publicKeyJwk),
    },
    pendingKey: current.pendingPublicKey || null,
    capabilities: [
      "room-metadata",
      "file-list-cursor",
      "file-stream-range",
      "activitystreams-invalidation",
    ],
    endpoints: {
      hello: `${current.publicBaseUrl}/api/federation/v1/hello`,
      room: `${current.publicBaseUrl}/api/federation/v1/rooms/{roomId}`,
      files:
        `${current.publicBaseUrl}/api/federation/v1/rooms/{roomId}/files`,
      stream: `${current.publicBaseUrl}/api/federation/v1/files/{fileKey}`,
      inbox: `${current.publicBaseUrl}/api/federation/v1/inbox`,
    },
  };
}

async function authenticate(req, res, next) {
  const current = config();
  const id = requestId(req);
  req.federationRequestId = id;
  if (!current.enabled) {
    return federationError(
      res,
      404,
      "FEDERATION_DISABLED",
      "Federation is not available.",
      id,
    );
  }
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    const result = await verifyFederationRequest(req, current, body);
    if (!result.ok) {
      const status =
        result.code === "FEDERATION_PEER_UNKNOWN" ? 403 : 401;
      appendFederationAudit(current, {
        requestId: id,
        peerId: null,
        method: req.method,
        path: req.path,
        status,
        code: result.code,
      });
      return federationError(
        res,
        status,
        result.code,
        "The federation request could not be authenticated.",
        id,
      );
    }
    const fileRequest = req.path.startsWith("/api/federation/v1/files/");
    const limit = fileRequest ?
      current.limits.downloadsPerMinute :
      current.limits.requestsPerMinute;
    const window = Math.floor(Date.now() / 60000);
    const rateKey =
      `federation:rate:${result.peer.peerId}:` +
      `${fileRequest ? "download" : "request"}:${window}`;
    const count = Number(await federationRedis.incr(rateKey));
    if (count === 1) {
      await federationRedis.expire(rateKey, 120);
    }
    if (count > limit) {
      res.set("Retry-After", "60");
      appendFederationAudit(current, {
        requestId: id,
        peerId: result.peer.peerId,
        method: req.method,
        path: req.path,
        status: 429,
        code: "FEDERATION_RATE_LIMITED",
      });
      return federationError(
        res,
        429,
        "FEDERATION_RATE_LIMITED",
        "This peer has exceeded its federation request limit.",
        id,
      );
    }
    req.federation = { config: current, peer: result.peer };
    res.once("finish", () => {
      appendFederationAudit(current, {
        requestId: id,
        peerId: result.peer.peerId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        code: res.statusCode < 400 ? "FEDERATION_OK" : "FEDERATION_ERROR",
      });
    });
    return next();
  }
  catch (error) {
    console.error("[federation] signature verification failed", error);
    appendFederationAudit(current, {
      requestId: id,
      peerId: null,
      method: req.method,
      path: req.path,
      status: 401,
      code: "FEDERATION_SIGNATURE_INVALID",
    });
    return federationError(
      res,
      401,
      "FEDERATION_SIGNATURE_INVALID",
      "The federation request could not be authenticated.",
      id,
    );
  }
}

async function authorizedRoom(req, res) {
  const roomId = String(req.params.roomId || req.query.roomId || "");
  const { peer } = req.federation;
  if (!peerAllowsRoom(peer, roomId)) {
    federationError(
      res,
      404,
      "FEDERATION_ROOM_UNAVAILABLE",
      "The requested room is not available to this peer.",
      req.federationRequestId,
    );
    return null;
  }
  const room = await Room.get(roomId);
  if (
    !room ||
    room.config.get("allowFederation") !== true ||
    (room.config.get("inviteonly") &&
      room.config.get("allowPrivateFederation") !== true)
  ) {
    federationError(
      res,
      404,
      "FEDERATION_ROOM_UNAVAILABLE",
      "The requested room is not available to this peer.",
      req.federationRequestId,
    );
    return null;
  }
  return room;
}

function roomMeta(room) {
  return {
    id: room.roomid,
    name: String(room.config.get("roomname") || room.roomid).slice(0, 160),
    private: !!room.config.get("inviteonly"),
  };
}

function cursorOffset(raw, roomId) {
  if (!raw) {
    return 0;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(String(raw), "base64url").toString("utf8"),
    );
    if (parsed.roomId !== roomId || !Number.isInteger(parsed.offset)) {
      return 0;
    }
    return Math.max(0, parsed.offset);
  }
  catch (_) {
    return 0;
  }
}

function nextCursor(roomId, offset) {
  return Buffer.from(JSON.stringify({ roomId, offset })).toString("base64url");
}

function safeFile(upload) {
  return {
    key: upload.key,
    name: String(upload.name || "file").slice(0, 256),
    size: Number(upload.size) || 0,
    type: String(upload.type || "file").slice(0, 80),
    mime: String(
      (upload.storage && upload.storage.mime) || "application/octet-stream",
    ).slice(0, 200),
    uploadedAt: new Date(Number(upload.uploaded) || 0).toISOString(),
    expiresAt: new Date(Number(upload.expires) || 0).toISOString(),
    digest: null,
  };
}

function actorDocument(current) {
  const actor = `${current.publicBaseUrl}/federation/actor`;
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    "id": actor,
    "type": "Service",
    "preferredUsername": "dicefiles",
    "name": current.displayName,
    "url": current.publicBaseUrl,
    "publicKey": {
      id: keyId(current),
      owner: actor,
      publicKeyPem: current.publicKeyPem,
      publicKeyJwk: current.publicKeyJwk,
    },
  };
}

function registerFederationRoutes(app) {
  app.get("/.well-known/dicefiles-federation", (req, res) => {
    const current = config();
    if (!current.enabled) {
      return res.sendStatus(404);
    }
    res.set("Cache-Control", "public, max-age=300");
    return res.json(discoveryDocument(current));
  });

  app.get("/.well-known/webfinger", (req, res) => {
    const current = config();
    if (!current.enabled) {
      return res.sendStatus(404);
    }
    const actor = `${current.publicBaseUrl}/federation/actor`;
    const {host} = new URL(current.publicBaseUrl);
    const resource = String(req.query.resource || "");
    if (resource !== actor && resource !== `acct:dicefiles@${host}`) {
      return res.sendStatus(404);
    }
    res.type("application/jrd+json");
    return res.json({
      subject: `acct:dicefiles@${host}`,
      aliases: [actor],
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: actor,
        },
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: `${current.publicBaseUrl}/nodeinfo/2.1`,
        },
      ],
    });
  });

  app.get("/.well-known/nodeinfo", (_req, res) => {
    const current = config();
    if (!current.enabled) {
      return res.sendStatus(404);
    }
    return res.json({
      links: [
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: `${current.publicBaseUrl}/nodeinfo/2.1`,
        },
      ],
    });
  });

  app.get("/nodeinfo/2.1", (_req, res) => {
    const current = config();
    if (!current.enabled) {
      return res.sendStatus(404);
    }
    return res.json({
      version: "2.1",
      software: {
        name: "dicefiles",
        version: pkg.version,
        repository:
          "https://github.com/realDolos/Dicefiles-Ephemereal-Filesharing",
      },
      protocols: ["activitypub"],
      services: { inbound: [], outbound: [] },
      openRegistrations: false,
      usage: { users: { total: 0 }, localPosts: 0 },
      metadata: {
        dicefilesFederation: PROTOCOL_VERSION,
        privacySafeCounts: true,
      },
    });
  });

  app.get("/federation/actor", (_req, res) => {
    const current = config();
    if (!current.enabled) {
      return res.sendStatus(404);
    }
    res.type("application/activity+json");
    res.set("Cache-Control", "public, max-age=300");
    return res.json(actorDocument(current));
  });

  app.get(
    "/federation/files/:destinationRoomId/:peerId/:roomId/:key/:name?",
    getUser,
    async (req, res, next) => {
      try {
        const room = await Room.get(String(req.params.destinationRoomId || ""));
        const link =
          room &&
          normalizeFederatedRoomLinks(
            room.config.get("federatedRooms"),
          ).find(
            row =>
              row.peerId === req.params.peerId &&
              row.roomId === req.params.roomId,
          );
        if (!room || !link) {
          return res.sendStatus(404);
        }
        const role = req.user && req.user.role || "white";
        const account = req.user && req.user.account;
        const roomToken = rtoken(req);
        const owner = room.owns(account, roomToken);
        const member =
          owner ||
          role === "mod" ||
          !!(account && room.invitees.has(account)) ||
          room.hasGuestPass(roomToken);
        if (
          (room.config.get("inviteonly") && !member) ||
          !linkVisibilityAllows(link.visibility, {
            role,
            authenticated: !!account,
            member,
            owner,
          })
        ) {
          return res.sendStatus(404);
        }
        return await proxyRemoteFile(
          req,
          res,
          link.peerId,
          link.roomId,
          String(req.params.key || ""),
        );
      }
      catch (error) {
        if (res.headersSent) {
          return next(error);
        }
        return federationError(
          res,
          error.status || 502,
          error.code || "FEDERATION_PROXY_FAILED",
          "The remote file could not be streamed.",
          requestId(req),
        );
      }
    },
  );

  app.get(
    "/api/federation/v1/hello",
    authenticate,
    (req, res) => {
      const current = req.federation.config;
      return res.json({
        protocolVersion: PROTOCOL_VERSION,
        peerId: current.peerId,
        displayName: current.displayName,
        authenticatedPeer: req.federation.peer.peerId,
        capabilities: discoveryDocument(current).capabilities,
        serverTime: new Date().toISOString(),
      });
    },
  );

  app.get(
    "/api/federation/v1/rooms/:roomId",
    authenticate,
    async (req, res) => {
      const room = await authorizedRoom(req, res);
      if (!room) {
        return;
      }
      return res.json({
        protocolVersion: PROTOCOL_VERSION,
        room: roomMeta(room),
      });
    },
  );

  app.get(
    "/api/federation/v1/rooms/:roomId/files",
    authenticate,
    async (req, res) => {
      const room = await authorizedRoom(req, res);
      if (!room) {
        return;
      }
      const max = req.federation.config.limits.maxPageSize;
      const requested = Number(req.query.limit);
      const limit = Number.isFinite(requested) ?
        Math.max(1, Math.min(max, Math.floor(requested))) :
        req.federation.config.limits.pageSize;
      const offset = cursorOffset(req.query.cursor, room.roomid);
      const ruleValidation = requestedFederationRules(req.query.rules);
      if (!ruleValidation.valid) {
        return federationError(
          res,
          400,
          "FEDERATION_RULES_INVALID",
          Object.values(ruleValidation.errors).join(" "),
          req.federationRequestId,
        );
      }
      const uploads = Array.from(await UPLOAD.EMITTER.for(room)).
        filter(
          upload =>
            upload &&
            !upload.expired &&
            !upload.hidden &&
            !(upload.meta && upload.meta.request) &&
            fileMatchesLinkRules(
              federationRuleFile(upload),
              ruleValidation.rules,
            ),
        ).
        sort(
          (a, b) =>
            Number(a.uploaded) - Number(b.uploaded) ||
            String(a.key).localeCompare(String(b.key)),
        );
      const page = uploads.slice(offset, offset + limit);
      return res.json({
        protocolVersion: PROTOCOL_VERSION,
        room: roomMeta(room),
        files: page.map(safeFile),
        nextCursor:
          offset + page.length < uploads.length ?
            nextCursor(room.roomid, offset + page.length) :
            null,
      });
    },
  );

  app.get(
    "/api/federation/v1/files/:key",
    authenticate,
    async (req, res, next) => {
      const room = await authorizedRoom(req, res);
      if (!room) {
        return;
      }
      const upload = await UPLOAD.UPLOADS.get(String(req.params.key || ""));
      if (
        !upload ||
        upload.roomid !== room.roomid ||
        upload.expired ||
        upload.hidden
      ) {
        return federationError(
          res,
          404,
          "FEDERATION_FILE_UNAVAILABLE",
          "The requested file is not available.",
          req.federationRequestId,
        );
      }
      res.set("X-Dicefiles-Federation", PROTOCOL_VERSION);
      return UPLOAD.serve(req, res, next);
    },
  );

  app.post(
    "/api/federation/v1/inbox",
    express.raw({
      type: ["application/activity+json", "application/ld+json", "application/json"],
      limit: "1mb",
    }),
    authenticate,
    (req, res) => {
      let activity;
      try {
        activity = JSON.parse(req.body.toString("utf8"));
      }
      catch (_) {
        return federationError(
          res,
          400,
          "FEDERATION_ACTIVITY_INVALID",
          "The activity body is invalid.",
          req.federationRequestId,
        );
      }
      const type = String(activity.type || "");
      const object = activity.object || {};
      const roomId = String(object.roomId || "");
      if (!["Add", "Remove", "Update"].includes(type) || !roomId) {
        return federationError(
          res,
          400,
          "FEDERATION_ACTIVITY_UNSUPPORTED",
          "The activity type is not supported.",
          req.federationRequestId,
        );
      }
      invalidateRemoteRoom(req.federation.peer.peerId, roomId);
      return res.status(202).json({
        protocolVersion: PROTOCOL_VERSION,
        accepted: true,
      });
    },
  );
}

module.exports = {
  PROTOCOL_VERSION,
  config,
  discoveryDocument,
  actorDocument,
  cursorOffset,
  nextCursor,
  safeFile,
  readFederationAudit,
  registerFederationRoutes,
};
