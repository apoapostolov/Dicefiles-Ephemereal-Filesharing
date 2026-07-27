"use strict";

/**
 * Multi-room file linking helpers (destination mirrors source uploads).
 * Pure — no Redis/Room I/O.
 *
 * Source rooms must opt in via allowCrossLinking before their files appear
 * in a destination list. Destinations list sources by id or room name.
 */

const ROOM_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;

function isValidRoomId(id) {
  return typeof id === "string" && ROOM_ID_RE.test(id);
}

/**
 * Source room must explicitly allow others to mirror finished uploads.
 * Default off (undefined/null/false → denied).
 * @param {unknown} configValue
 * @returns {boolean}
 */
function isCrossLinkingAllowed(configValue) {
  return configValue === true || configValue === 1 || configValue === "1";
}

/**
 * Normalize a stored linkedRooms value to a unique array of valid room ids.
 * (Names are resolved before storage — this only accepts ids.)
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
      list = Array.isArray(parsed) ? parsed : splitLinkedRoomInput(raw);
    } catch (_) {
      list = splitLinkedRoomInput(raw);
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
 * Split admin input into tokens. Prefer commas / newlines so multi-word
 * room names can be entered (e.g. "Campaign Maps, abCdEf12Gh").
 * @param {unknown} raw
 * @returns {string[]}
 */
function splitLinkedRoomInput(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve user tokens (room id and/or room name) to unique room ids.
 *
 * Matching order per token:
 * 1. Exact room id (when token is a valid id and exists in catalog)
 * 2. Case-insensitive exact room name (unique match)
 *
 * Ambiguous or unknown tokens go to `unresolved`.
 *
 * @param {unknown} raw — string, array of tokens, or already-normalized ids
 * @param {Iterable<{roomid: string, name?: string}>} catalog
 * @param {string} [selfRoomId]
 * @returns {{ids: string[], unresolved: string[]}}
 */
function resolveLinkedRoomTokens(raw, catalog, selfRoomId) {
  const tokens = splitLinkedRoomInput(raw);
  const rooms = Array.from(catalog || []);
  const byId = new Map();
  const byName = new Map(); // lower(name) → roomid[] (for ambiguity)
  for (const r of rooms) {
    if (!r || !r.roomid) {
      continue;
    }
    byId.set(r.roomid, r);
    const n = String(r.name || "").trim().toLowerCase();
    if (!n) {
      continue;
    }
    if (!byName.has(n)) {
      byName.set(n, []);
    }
    byName.get(n).push(r.roomid);
  }

  const ids = [];
  const seen = new Set();
  const unresolved = [];

  for (const token of tokens) {
    let resolved = null;

    if (isValidRoomId(token) && byId.has(token)) {
      resolved = token;
    } else {
      const hits = byName.get(token.toLowerCase()) || [];
      if (hits.length === 1) {
        resolved = hits[0];
      } else if (hits.length > 1) {
        // Prefer exact id if token also happens to be an id among hits
        if (isValidRoomId(token) && hits.includes(token)) {
          resolved = token;
        } else {
          unresolved.push(token);
          continue;
        }
      } else if (isValidRoomId(token)) {
        // Valid id form but not in catalog (stale/offline) — still store so
        // files appear when the room exists and allows linking.
        resolved = token;
      } else {
        unresolved.push(token);
        continue;
      }
    }

    if (selfRoomId && resolved === selfRoomId) {
      unresolved.push(token);
      continue;
    }
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    ids.push(resolved);
  }

  return { ids, unresolved };
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

/**
 * Whether a source room's files should be mirrored into a destination list.
 * Requires the source room owner to have enabled allowCrossLinking.
 * @param {object|null|undefined} sourceConfig — room.config-like gettable, or plain object
 * @returns {boolean}
 */
function sourceAllowsCrossLink(sourceConfig) {
  if (!sourceConfig) {
    return false;
  }
  const raw =
    typeof sourceConfig.get === "function"
      ? sourceConfig.get("allowCrossLinking")
      : sourceConfig.allowCrossLinking;
  return isCrossLinkingAllowed(raw);
}

module.exports = {
  ROOM_ID_RE,
  isValidRoomId,
  isCrossLinkingAllowed,
  normalizeLinkedRooms,
  splitLinkedRoomInput,
  resolveLinkedRoomTokens,
  addLinkedRoom,
  removeLinkedRoom,
  markLinkedClientFile,
  isLinkableSourceFile,
  includeLinkedForRole,
  sourceAllowsCrossLink,
};
