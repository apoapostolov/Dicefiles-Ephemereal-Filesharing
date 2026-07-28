"use strict";

const dns = require("dns").promises;
const net = require("net");
const { Readable } = require("stream");
const CONFIG = require("../config");
const { normalizeFederationConfig, getPeer } = require("./config");
const { signFederationRequest } = require("./signatures");

const circuitState = new Map();
const roomCache = new Map();
let activeStreams = 0;

class FederationError extends Error {
  constructor(message, code = "FEDERATION_TRANSPORT", status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function currentConfig() {
  return normalizeFederationConfig(
    CONFIG.get("federation"),
    CONFIG.get("publicBaseUrl"),
  );
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }
  const value = String(address).toLowerCase();
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

async function validatePeerDestination(peer) {
  if (peer.allowPrivateNetwork) {
    return;
  }
  const { hostname } = new URL(peer.baseUrl);
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(row => isPrivateIp(row.address))) {
    throw new FederationError(
      `Peer ${peer.peerId} resolves to a private or unavailable address`,
      "FEDERATION_DESTINATION_BLOCKED",
    );
  }
}

function circuit(peer, config) {
  const state = circuitState.get(peer.peerId);
  if (state && state.openUntil > Date.now()) {
    throw new FederationError(
      `Peer ${peer.peerId} circuit is temporarily open`,
      "FEDERATION_CIRCUIT_OPEN",
      503,
    );
  }
  if (state && state.openUntil) {
    circuitState.delete(peer.peerId);
  }
  return config.limits;
}

function noteSuccess(peerId) {
  circuitState.delete(peerId);
}

function noteFailure(peerId, limits) {
  const previous = circuitState.get(peerId) || { failures: 0, openUntil: 0 };
  const failures = previous.failures + 1;
  circuitState.set(peerId, {
    failures,
    openUntil:
      failures >= limits.circuitBreakerThreshold ?
        Date.now() + limits.circuitOpenMs :
        0,
  });
}

async function signedFetch(peerId, pathname, options = {}) {
  const config = currentConfig();
  if (!config.enabled) {
    throw new FederationError(
      "Federation is disabled",
      "FEDERATION_DISABLED",
      503,
    );
  }
  const peer = getPeer(config, peerId);
  if (!peer) {
    throw new FederationError(
      `Unknown federation peer ${peerId}`,
      "FEDERATION_PEER_UNKNOWN",
      404,
    );
  }
  const limits = circuit(peer, config);
  await validatePeerDestination(peer);
  const url = new URL(pathname, `${peer.baseUrl}/`);
  if (url.origin !== peer.baseUrl) {
    throw new FederationError(
      "Federation request escaped the pinned peer origin",
      "FEDERATION_DESTINATION_BLOCKED",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const headers = new Headers(options.headers || {});
    headers.set("accept", options.accept || "application/json");
    headers.set("user-agent", "Dicefiles-Federation/1.0");
    let {body} = options;
    if (
      body &&
      typeof body === "object" &&
      !Buffer.isBuffer(body) &&
      !(body instanceof ArrayBuffer)
    ) {
      body = JSON.stringify(body);
      headers.set("content-type", "application/activity+json");
    }
    const unsigned = new Request(url, {
      method: options.method || "GET",
      headers,
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    const signed = await signFederationRequest(unsigned, config);
    const response = await fetch(signed, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new FederationError(
        `Peer ${peerId} attempted a redirect`,
        "FEDERATION_REDIRECT_BLOCKED",
      );
    }
    if (!response.ok) {
      throw new FederationError(
        `Peer ${peerId} returned HTTP ${response.status}`,
        response.status === 404 ?
          "FEDERATION_REMOTE_MISSING" :
          response.status === 403 ?
            "FEDERATION_REMOTE_DENIED" :
            "FEDERATION_REMOTE_ERROR",
        response.status,
      );
    }
    noteSuccess(peer.peerId);
    return { response, peer, config };
  }
  catch (error) {
    noteFailure(peer.peerId, limits);
    if (error instanceof FederationError) {
      throw error;
    }
    throw new FederationError(
      error && error.name === "AbortError" ?
        `Peer ${peerId} timed out` :
        `Peer ${peerId} is unreachable`,
      error && error.name === "AbortError" ?
        "FEDERATION_TIMEOUT" :
        "FEDERATION_UNREACHABLE",
      503,
    );
  }
  finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new FederationError(
      "Federation JSON response is too large",
      "FEDERATION_RESPONSE_TOO_LARGE",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new FederationError(
      "Federation JSON response is too large",
      "FEDERATION_RESPONSE_TOO_LARGE",
    );
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  }
  catch (_) {
    throw new FederationError(
      "Federation peer returned invalid JSON",
      "FEDERATION_RESPONSE_INVALID",
    );
  }
  return value;
}

function validateRoomPayload(payload) {
  if (
    !payload ||
    payload.protocolVersion !== "1.0" ||
    !payload.room ||
    typeof payload.room.id !== "string" ||
    !Array.isArray(payload.files)
  ) {
    throw new FederationError(
      "Federation peer returned an incompatible room response",
      "FEDERATION_PROTOCOL_MISMATCH",
    );
  }
  const files = payload.files.slice(0, 500).map(file => {
    if (
      !file ||
      typeof file.key !== "string" ||
      typeof file.name !== "string" ||
      !Number.isFinite(Number(file.size)) ||
      typeof file.expiresAt !== "string"
    ) {
      throw new FederationError(
        "Federation peer returned malformed file metadata",
        "FEDERATION_RESPONSE_INVALID",
      );
    }
    return {
      key: file.key.slice(0, 300),
      name: file.name.slice(0, 256),
      size: Number(file.size),
      type: String(file.type || "file").slice(0, 80),
      uploadedAt: String(file.uploadedAt || ""),
      expiresAt: String(file.expiresAt),
      digest: file.digest ? String(file.digest).slice(0, 300) : null,
      roomName: String(payload.room.name || payload.room.id).slice(0, 160),
    };
  });
  return {
    room: {
      id: payload.room.id,
      name: String(payload.room.name || payload.room.id).slice(0, 160),
    },
    files,
    nextCursor:
      typeof payload.nextCursor === "string" ? payload.nextCursor : null,
  };
}

async function getRemoteRoomFiles(peerId, roomId, { refresh = false } = {}) {
  const config = currentConfig();
  const cacheKey = `${peerId}\0${roomId}`;
  const cached = roomCache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const files = [];
  let cursor = null;
  let room = null;
  let peer = null;
  for (let page = 0; page < 10 && files.length < 2000; page++) {
    const query = new URLSearchParams({
      limit: String(config.limits.maxPageSize),
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const path =
      `/api/federation/v1/rooms/${encodeURIComponent(roomId)}/files?${
        query.toString()}`;
    const {
      response,
      peer: resultPeer,
    } = await signedFetch(peerId, path);
    const payload = validateRoomPayload(
      await readBoundedJson(response, config.limits.maxJsonBytes),
    );
    const {
      room: payloadRoom,
      files: payloadFiles,
      nextCursor: payloadCursor,
    } = payload;
    if (
      payloadRoom.id !== roomId ||
      (room && room.id !== payloadRoom.id)
    ) {
      throw new FederationError(
        "Federation peer changed room identity between pages",
        "FEDERATION_RESPONSE_INVALID",
      );
    }
    peer = resultPeer;
    room = payloadRoom;
    files.push(...payloadFiles);
    cursor = payloadCursor;
    if (!cursor) {
      break;
    }
  }
  const value = {
    peer,
    room: room || { id: roomId, name: roomId },
    files: files.slice(0, 2000),
    nextCursor: cursor,
  };
  roomCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + config.limits.cacheTtlMs,
  });
  return value;
}

function invalidateRemoteRoom(peerId, roomId) {
  roomCache.delete(`${peerId}\0${roomId}`);
}

async function proxyRemoteFile(req, res, peerId, roomId, remoteKey) {
  const config = currentConfig();
  if (activeStreams >= config.limits.maxConcurrentStreams) {
    throw new FederationError(
      "Federation stream limit reached",
      "FEDERATION_STREAM_LIMIT",
      503,
    );
  }
  activeStreams++;
  try {
    const headers = {};
    if (req.get("range")) {
      headers.range = req.get("range");
    }
    const path =
      `/api/federation/v1/files/${encodeURIComponent(remoteKey)}?` +
      `roomId=${encodeURIComponent(roomId)}`;
    const { response } = await signedFetch(peerId, path, {
      headers,
      accept: "*/*",
    });
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
      "cache-control",
      "content-digest",
    ]) {
      const value = response.headers.get(name);
      if (value) {
        res.setHeader(name, value);
      }
    }
    res.status(response.status);
    if (!response.body) {
      res.end();
      return;
    }
    await new Promise((resolve, reject) => {
      const stream = Readable.fromWeb(response.body);
      stream.on("error", reject);
      res.on("close", resolve);
      res.on("finish", resolve);
      stream.pipe(res);
    });
  }
  finally {
    activeStreams--;
  }
}

async function probePeerRoom(peerId, roomId) {
  try {
    const path = `/api/federation/v1/rooms/${encodeURIComponent(roomId)}`;
    const { response, config, peer } = await signedFetch(peerId, path);
    const value = await readBoundedJson(response, config.limits.maxJsonBytes);
    return {
      status: "active",
      peerId,
      roomId,
      peerName: peer.displayName,
      roomName:
        value && value.room && value.room.name ?
          String(value.room.name).slice(0, 160) :
          roomId,
    };
  }
  catch (error) {
    const statusByCode = {
      FEDERATION_REMOTE_DENIED: "denied",
      FEDERATION_REMOTE_MISSING: "missing",
      FEDERATION_KEY_INVALID: "key-invalid",
      FEDERATION_PROTOCOL_MISMATCH: "protocol-mismatch",
      FEDERATION_CIRCUIT_OPEN: "circuit-open",
    };
    return {
      status: statusByCode[error.code] || "unreachable",
      peerId,
      roomId,
      error: error.code,
    };
  }
}

async function probePeer(peerId) {
  const started = Date.now();
  try {
    const { response, config, peer } = await signedFetch(
      peerId,
      "/api/federation/v1/hello",
    );
    const hello = await readBoundedJson(
      response,
      config.limits.maxJsonBytes,
    );
    if (
      !hello ||
      hello.protocolVersion !== "1.0" ||
      hello.authenticatedPeer !== config.peerId
    ) {
      throw new FederationError(
        "Peer returned an incompatible hello response",
        "FEDERATION_PROTOCOL_MISMATCH",
      );
    }
    return {
      peerId,
      displayName: peer.displayName,
      baseUrl: peer.baseUrl,
      status: "active",
      latencyMs: Date.now() - started,
      protocolVersion: hello.protocolVersion,
      capabilities: Array.isArray(hello.capabilities) ?
        hello.capabilities.slice(0, 20) :
        [],
    };
  }
  catch (error) {
    return {
      peerId,
      status:
        error.code === "FEDERATION_CIRCUIT_OPEN" ?
          "circuit-open" :
          error.code === "FEDERATION_PROTOCOL_MISMATCH" ?
            "protocol-mismatch" :
            "unreachable",
      latencyMs: Date.now() - started,
      error: error.code || "FEDERATION_UNREACHABLE",
    };
  }
}

function listPeerStatuses() {
  const config = currentConfig();
  if (!config.enabled) {
    return [];
  }
  return Promise.all(
    config.peers.
      filter(peer => peer.enabled).
      map(peer => probePeer(peer.peerId)),
  );
}

module.exports = {
  FederationError,
  currentConfig,
  isPrivateIp,
  validatePeerDestination,
  signedFetch,
  readBoundedJson,
  validateRoomPayload,
  getRemoteRoomFiles,
  invalidateRemoteRoom,
  proxyRemoteFile,
  probePeerRoom,
  probePeer,
  listPeerStatuses,
  _circuitState: circuitState,
  _roomCache: roomCache,
};
