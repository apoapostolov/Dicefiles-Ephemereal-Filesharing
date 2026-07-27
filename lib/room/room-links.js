"use strict";

/**
 * Multi-room file linking helpers (destination mirrors source uploads).
 * Pure — no Redis/Room I/O.
 */

const ROOM_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;

function isValidRoomId(id) {
  return typeof id === "string" && ROOM_ID_RE.test(id);
}

/**
 * Normalize a stored linkedRooms value to a unique array of valid room ids.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeLinkedRooms(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  let list = raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : raw.split(/[\s,]+/);
    } catch (_) {
      list = raw.split(/[\s,]+/);
    }
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = String(item || "").trim();
    if (!isValidRoomId(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {string[]} current
 * @param {string} roomId
 * @param {string} [selfRoomId] — reject self-link when set
 * @returns {string[]}
 */
function addLinkedRoom(current, roomId, selfRoomId) {
  const id = String(roomId || "").trim();
  if (!isValidRoomId(id)) {
    throw new Error("Invalid room id");
  }
  if (selfRoomId && id === selfRoomId) {
    throw new Error("Cannot link a room to itself");
  }
  const list = normalizeLinkedRooms(current);
  if (list.includes(id)) {
    return list;
  }
  return list.concat(id);
}

/**
 * @param {string[]} current
 * @param {string} roomId
 * @returns {string[]}
 */
function removeLinkedRoom(current, roomId) {
  const id = String(roomId || "").trim();
  return normalizeLinkedRooms(current).filter((x) => x !== id);
}

/**
 * Mark a client-facing file JSON as linked from another room.
 * @param {object} file — client JSON from toClientJSON/sanitize
 * @param {string} sourceRoomId
 * @param {string} [sourceRoomName]
 * @returns {object}
 */
function markLinkedClientFile(file, sourceRoomId, sourceRoomName) {
  if (!file || typeof file !== "object") {
    return file;
  }
  const meta = Object.assign({}, file.meta || {}, {
    linkedFrom: sourceRoomId,
    linkedRoomName: sourceRoomName || sourceRoomId,
  });
  const tags = Object.assign({}, file.tags || {}, {
    linked: sourceRoomName || sourceRoomId,
  });
  return Object.assign({}, file, {
    meta,
    tags,
    linked: true,
    linkedFrom: sourceRoomId,
  });
}

/**
 * Finished upload (not a request card).
 * @param {object} file
 * @returns {boolean}
 */
function isLinkableSourceFile(file) {
  if (!file || typeof file !== "object") {
    return false;
  }
  if (file.meta && file.meta.request) {
    return false;
  }
  if (file.hidden) {
    return false;
  }
  return true;
}

/**
 * Should destination list include this source file for a viewer role?
 * @param {object} file — client JSON (may include hidden for mod lists)
 * @param {string} role
 * @returns {boolean}
 */
function includeLinkedForRole(file, role) {
  if (!file || typeof file !== "object") {
    return false;
  }
  if (file.meta && file.meta.request) {
    return false;
  }
  if (role !== "mod" && file.hidden) {
    return false;
  }
  return true;
}

module.exports = {
  ROOM_ID_RE,
  isValidRoomId,
  normalizeLinkedRooms,
  addLinkedRoom,
  removeLinkedRoom,
  markLinkedClientFile,
  isLinkableSourceFile,
  includeLinkedForRole,
};
