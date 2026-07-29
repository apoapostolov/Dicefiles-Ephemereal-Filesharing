"use strict";

const net = require("net");

const PEER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const ROOM_ID_PATTERN = /^[^\s/?#]{1,160}$/;

function cleanString(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizeOrigin(value, label = "federation origin") {
  let parsed;
  try {
    parsed = new URL(cleanString(value));
  }
  catch (_) {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    throw new Error(`${label} must be an origin without credentials or a path`);
  }
  return parsed.origin;
}

function isLoopbackHost(hostname) {
  const host = cleanString(hostname).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  const kind = net.isIP(host);
  if (kind === 4) {
    return host.startsWith("127.");
  }
  if (kind === 6) {
    return host === "::1";
  }
  return false;
}

function normalizeRoomAllowlist(value) {
  const rows = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      rows.
        map(item => cleanString(item, 160)).
        filter(item => item === "*" || ROOM_ID_PATTERN.test(item)),
    ),
  ).slice(0, 500);
}

function normalizePeer(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Each federation peer must be an object");
  }
  const peerId = cleanString(raw.peerId, 64);
  if (!PEER_ID_PATTERN.test(peerId)) {
    throw new Error(`Invalid federation peer id: ${peerId || "<empty>"}`);
  }
  const baseUrl = normalizeOrigin(raw.baseUrl, `baseUrl for peer ${peerId}`);
  const parsed = new URL(baseUrl);
  const allowInsecureHttp =
    raw.allowInsecureHttp === true || isLoopbackHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !allowInsecureHttp) {
    throw new Error(
      `Peer ${peerId} must use HTTPS (or explicitly allow insecure HTTP)`,
    );
  }
  const keyId = cleanString(
    raw.keyId || `${baseUrl}/federation/actor#main-key`,
    1000,
  );
  let parsedKeyId;
  try {
    parsedKeyId = new URL(keyId);
  }
  catch (_) {
    throw new Error(`Peer ${peerId} has an invalid keyId`);
  }
  if (parsedKeyId.origin !== baseUrl) {
    throw new Error(`Peer ${peerId} keyId must use its pinned origin`);
  }
  const publicKeyPem = cleanString(raw.publicKeyPem, 12000);
  const publicKeyJwk =
    raw.publicKeyJwk &&
    typeof raw.publicKeyJwk === "object" &&
    !Array.isArray(raw.publicKeyJwk) ?
      Object.assign({}, raw.publicKeyJwk) :
      null;
  if (!publicKeyPem && !publicKeyJwk) {
    throw new Error(`Peer ${peerId} needs publicKeyPem or publicKeyJwk`);
  }
  const acceptedKeys = [{
    keyId,
    publicKeyPem,
    publicKeyJwk,
  }];
  for (const candidate of Array.isArray(raw.acceptedPublicKeys) ?
    raw.acceptedPublicKeys.slice(0, 3) :
    []) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const candidateKeyId = cleanString(candidate.keyId, 1000);
    let candidateUrl;
    try {
      candidateUrl = new URL(candidateKeyId);
    }
    catch (_) {
      continue;
    }
    if (
      candidateUrl.origin !== baseUrl ||
      acceptedKeys.some(item => item.keyId === candidateKeyId)
    ) {
      continue;
    }
    const candidatePem = cleanString(candidate.publicKeyPem, 12000);
    const candidateJwk =
      candidate.publicKeyJwk &&
      typeof candidate.publicKeyJwk === "object" &&
      !Array.isArray(candidate.publicKeyJwk) ?
        Object.assign({}, candidate.publicKeyJwk) :
        null;
    if (!candidatePem && !candidateJwk) {
      continue;
    }
    acceptedKeys.push({
      keyId: candidateKeyId,
      publicKeyPem: candidatePem,
      publicKeyJwk: candidateJwk,
    });
  }
  return {
    peerId,
    displayName: cleanString(raw.displayName || peerId, 120),
    baseUrl,
    keyId,
    publicKeyPem,
    publicKeyJwk,
    acceptedKeys,
    enabled: raw.enabled !== false,
    allowedRooms: normalizeRoomAllowlist(raw.allowedRooms),
    allowInsecureHttp,
    allowPrivateNetwork:
      raw.allowPrivateNetwork === true || isLoopbackHost(parsed.hostname),
  };
}

function normalizeFederationConfig(raw, globalPublicBaseUrl = "") {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const enabled = source.enabled === true;
  let publicBaseUrl = cleanString(
    source.publicBaseUrl || globalPublicBaseUrl,
    1000,
  );
  if (publicBaseUrl) {
    publicBaseUrl = normalizeOrigin(publicBaseUrl, "federation.publicBaseUrl");
  }
  if (enabled && !publicBaseUrl) {
    throw new Error(
      "Federation is enabled but federation.publicBaseUrl is not configured",
    );
  }
  const peerId = cleanString(source.peerId, 64);
  if (enabled && !PEER_ID_PATTERN.test(peerId)) {
    throw new Error(
      "Federation is enabled but federation.peerId is missing or invalid",
    );
  }
  const peers = [];
  const ids = new Set();
  const keyIds = new Set();
  for (const row of Array.isArray(source.peers) ? source.peers : []) {
    const peer = normalizePeer(row);
    if (ids.has(peer.peerId) || keyIds.has(peer.keyId)) {
      throw new Error(`Duplicate federation peer identity: ${peer.peerId}`);
    }
    ids.add(peer.peerId);
    keyIds.add(peer.keyId);
    peers.push(peer);
  }
  const integer = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ?
      Math.max(min, Math.min(max, Math.floor(n))) :
      fallback;
  };
  const limits =
    source.limits && typeof source.limits === "object" ? source.limits : {};
  return {
    enabled,
    publicBaseUrl,
    keyId: cleanString(
      source.keyId ||
        (publicBaseUrl ? `${publicBaseUrl}/federation/actor#main-key` : ""),
      1000,
    ),
    peerId,
    displayName: cleanString(source.displayName || peerId, 120),
    auditLog: cleanString(source.auditLog || "federation.log", 1000),
    privateKeyJwk: source.privateKeyJwk || null,
    publicKeyJwk: source.publicKeyJwk || null,
    publicKeyPem: cleanString(source.publicKeyPem, 12000),
    previousPublicKeys: Array.isArray(source.previousPublicKeys) ?
      source.previousPublicKeys.slice(0, 3) :
      [],
    pendingPublicKey:
      source.pendingIdentity &&
      typeof source.pendingIdentity === "object" ?
        {
          keyId: cleanString(source.pendingIdentity.keyId, 1000),
          publicKeyJwk: source.pendingIdentity.publicKeyJwk || null,
          publicKeyPem: cleanString(
            source.pendingIdentity.publicKeyPem,
            12000,
          ),
          fingerprint: cleanString(
            source.pendingIdentity.fingerprint,
            128,
          ),
          preparedAt: cleanString(
            source.pendingIdentity.preparedAt,
            100,
          ),
        } :
        null,
    peers,
    limits: {
      pageSize: integer(limits.pageSize, 100, 1, 200),
      maxPageSize: integer(limits.maxPageSize, 200, 1, 500),
      timeoutMs: integer(limits.timeoutMs, 10000, 1000, 60000),
      maxJsonBytes: integer(limits.maxJsonBytes, 1024 * 1024, 1024, 5 * 1024 * 1024),
      maxConcurrentStreams: integer(limits.maxConcurrentStreams, 4, 1, 32),
      requestsPerMinute: integer(
        limits.requestsPerMinute,
        600,
        10,
        100000,
      ),
      downloadsPerMinute: integer(
        limits.downloadsPerMinute,
        120,
        1,
        10000,
      ),
      cacheTtlMs: integer(limits.cacheTtlMs, 30000, 1000, 300000),
      circuitBreakerThreshold: integer(
        limits.circuitBreakerThreshold,
        3,
        1,
        20,
      ),
      circuitOpenMs: integer(limits.circuitOpenMs, 60000, 1000, 600000),
      replayWindowSeconds: integer(
        limits.replayWindowSeconds,
        300,
        60,
        900,
      ),
    },
  };
}

function peerAllowsRoom(peer, roomId) {
  return (
    peer.enabled &&
    (peer.allowedRooms.includes("*") || peer.allowedRooms.includes(roomId))
  );
}

function getPeer(config, peerId) {
  return config.peers.find(
    peer => peer.enabled && peer.peerId === cleanString(peerId, 64),
  );
}

module.exports = {
  PEER_ID_PATTERN,
  ROOM_ID_PATTERN,
  cleanString,
  normalizeOrigin,
  isLoopbackHost,
  normalizePeer,
  normalizeFederationConfig,
  peerAllowsRoom,
  getPeer,
};
