"use strict";

const crypto = require("crypto");
const {
  normalizeLinkRules,
  normalizeLinkVisibility,
} = require("../room/room-links");
const {
  PEER_ID_PATTERN,
  ROOM_ID_PATTERN,
  cleanString,
} = require("./config");

function normalizeFederatedRoomLink(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const peerId = cleanString(raw.peerId, 64);
  const roomId = cleanString(raw.roomId || raw.roomid, 160);
  if (!PEER_ID_PATTERN.test(peerId) || !ROOM_ID_PATTERN.test(roomId)) {
    return null;
  }
  const link = { peerId, roomId };
  const name = cleanString(raw.name, 160);
  if (name) {
    link.name = name;
  }
  const visibility = normalizeLinkVisibility(raw.visibility);
  if (visibility !== "all") {
    link.visibility = visibility;
  }
  const rules = normalizeLinkRules(raw.rules);
  if (rules) {
    link.rules = rules;
  }
  return link;
}

function normalizeFederatedRoomLinks(raw) {
  let rows = raw;
  if (typeof raw === "string") {
    try {
      rows = JSON.parse(raw);
    }
    catch (_) {
      return [];
    }
  }
  if (!Array.isArray(rows)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const link = normalizeFederatedRoomLink(row);
    const key = link && `${link.peerId}\0${link.roomId}`;
    if (!link || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(link);
  }
  return out.slice(0, 50);
}

function safeSegment(value) {
  return encodeURIComponent(String(value));
}

function federatedClientKey(peerId, roomId, remoteKey) {
  return `fed-${crypto.
    createHash("sha256").
    update(`${peerId}\0${roomId}\0${remoteKey}`).
    digest("base64url").
    slice(0, 32)}`;
}

function remoteFileToClient(file, link, destinationRoomId) {
  const linkedName =
    link.name || `${link.peerDisplayName || link.peerId} / ${file.roomName || link.roomId}`;
  const key = federatedClientKey(link.peerId, link.roomId, file.key);
  const name = cleanString(file.name, 256) || "remote-file";
  const remoteSource = `${link.peerId}/${link.roomId}`;
  return {
    key,
    href:
      `/federation/files/${safeSegment(destinationRoomId)}/` +
      `${safeSegment(link.peerId)}/${safeSegment(link.roomId)}/` +
      `${safeSegment(file.key)}/${safeSegment(name)}`,
    name,
    size: Number(file.size) || 0,
    type: cleanString(file.type, 80) || "file",
    roomid: destinationRoomId,
    hash: cleanString(file.digest, 300) || key,
    uploaded: Date.parse(file.uploadedAt) || 0,
    expires: Date.parse(file.expiresAt) || 0,
    assets: [],
    tags: {
      linked: linkedName,
      federated: link.peerDisplayName || link.peerId,
    },
    meta: {
      linkedFrom: remoteSource,
      linkedRoomName: linkedName,
      federated: true,
      federationPeerId: link.peerId,
      federationRoomId: link.roomId,
      remoteKey: file.key,
    },
    linked: true,
    linkedFrom: remoteSource,
    federated: true,
  };
}

module.exports = {
  normalizeFederatedRoomLink,
  normalizeFederatedRoomLinks,
  federatedClientKey,
  remoteFileToClient,
};
