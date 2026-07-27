"use strict";

/**
 * Multi-room file linking helpers (destination mirrors source uploads).
 * Pure — no Redis/Room I/O.
 *
 * Config shape (backward compatible):
 *   linkedRooms: string[] | LinkEntry[]
 *   LinkEntry: {
 *     roomId: string,
 *     name?: string,          // cached display name at last save
 *     rules?: LinkRules
 *   }
 *   LinkRules: {
 *     nameContains?: string,  // case-insensitive filename substrings, comma-delimited (OR)
 *     tagContains?: string,   // case-insensitive match in any tag key/value
 *     types?: string[],       // allowed file.type values (image, video, …)
 *     maxAgeHours?: number,   // include only if uploaded within last N hours
 *     minAgeHours?: number,   // include only if uploaded at least N hours ago
 *   }
 *
 * Source rooms must opt in via allowCrossLinking.
 */

const ROOM_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;

/** Known client file.type values used by the filter toolbar. */
const LINK_FILE_TYPES = Object.freeze([
  "image",
  "video",
  "audio",
  "document",
  "archive",
  "file",
]);

const MS_PER_HOUR = 3600 * 1000;

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
 * Split admin input into tokens (comma / newline; multi-word names OK).
 * @param {unknown} raw
 * @returns {string[]}
 */
function splitLinkedRoomInput(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((s) => {
        if (s && typeof s === "object" && (s.roomId || s.roomid || s.id)) {
          return String(s.roomId || s.roomid || s.id || "").trim();
        }
        return String(s || "").trim();
      })
      .filter(Boolean);
  }
  return String(raw)
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Split a contains-rule value into non-empty terms.
 * Accepts comma-delimited string or string array.
 * @param {unknown} raw
 * @returns {string[]}
 */
function splitContainsTerms(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  let list;
  if (Array.isArray(raw)) {
    list = raw.map((s) => String(s || "").trim()).filter(Boolean);
  } else {
    list = String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // De-dupe case-insensitively, keep first spelling
  const out = [];
  const seen = new Set();
  for (const t of list) {
    const key = t.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Normalize rules object; empty/invalid fields dropped.
 * @param {unknown} raw
 * @returns {object|null} null when no effective rules
 */
function normalizeLinkRules(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rules = {};

  // Filename: comma-delimited substrings (OR). Array also accepted.
  const nameTerms = splitContainsTerms(raw.nameContains);
  if (nameTerms.length) {
    // Persist as comma-joined string for UI + wire stability
    rules.nameContains = nameTerms.join(", ");
  }
  if (typeof raw.tagContains === "string") {
    const s = raw.tagContains.trim();
    if (s) {
      rules.tagContains = s;
    }
  }

  let types = raw.types;
  if (typeof types === "string") {
    types = types.split(/[\s,]+/);
  }
  if (Array.isArray(types)) {
    const allowed = [];
    const seen = new Set();
    for (const t of types) {
      const v = String(t || "")
        .trim()
        .toLowerCase();
      if (!v || !LINK_FILE_TYPES.includes(v) || seen.has(v)) {
        continue;
      }
      seen.add(v);
      allowed.push(v);
    }
    if (allowed.length) {
      rules.types = allowed;
    }
  }

  const maxAge = Number(raw.maxAgeHours);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    rules.maxAgeHours = maxAge;
  }
  const minAge = Number(raw.minAgeHours);
  if (Number.isFinite(minAge) && minAge > 0) {
    rules.minAgeHours = minAge;
  }

  return Object.keys(rules).length ? rules : null;
}

/**
 * True when rules is null/empty (all finished source files pass).
 * @param {object|null|undefined} rules
 * @returns {boolean}
 */
function isEmptyLinkRules(rules) {
  return !rules || typeof rules !== "object" || !Object.keys(rules).length;
}

/**
 * Normalize one raw item into a LinkEntry or null.
 * @param {unknown} item
 * @returns {{roomId: string, name?: string, rules?: object}|null}
 */
function normalizeOneLinkEntry(item) {
  if (item == null || item === "") {
    return null;
  }
  if (typeof item === "string") {
    const id = item.trim();
    if (!isValidRoomId(id)) {
      return null;
    }
    return { roomId: id };
  }
  if (typeof item !== "object") {
    return null;
  }
  const id = String(item.roomId || item.roomid || item.id || "").trim();
  if (!isValidRoomId(id)) {
    return null;
  }
  const entry = { roomId: id };
  if (typeof item.name === "string" && item.name.trim()) {
    entry.name = item.name.trim();
  }
  const rules = normalizeLinkRules(item.rules);
  if (rules) {
    entry.rules = rules;
  }
  return entry;
}

/**
 * Normalize stored linkedRooms to unique LinkEntry list (rules preserved).
 * Accepts legacy string ids, JSON string, or objects.
 * @param {unknown} raw
 * @returns {Array<{roomId: string, name?: string, rules?: object}>}
 */
function normalizeLinkedRoomEntries(raw) {
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
    const entry = normalizeOneLinkEntry(item);
    if (!entry || seen.has(entry.roomId)) {
      continue;
    }
    seen.add(entry.roomId);
    out.push(entry);
  }
  return out;
}

/**
 * Legacy: unique array of room ids only.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeLinkedRooms(raw) {
  return normalizeLinkedRoomEntries(raw).map((e) => e.roomId);
}

/**
 * Resolve tokens (id and/or name) to room ids using a catalog.
 * @param {unknown} raw
 * @param {Iterable<{roomid: string, name?: string}>} catalog
 * @param {string} [selfRoomId]
 * @returns {{ids: string[], unresolved: string[]}}
 */
function resolveLinkedRoomTokens(raw, catalog, selfRoomId) {
  const tokens = splitLinkedRoomInput(raw);
  const rooms = Array.from(catalog || []);
  const byId = new Map();
  const byName = new Map();
  for (const r of rooms) {
    if (!r || !r.roomid) {
      continue;
    }
    byId.set(r.roomid, r);
    const n = String(r.name || "")
      .trim()
      .toLowerCase();
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
        if (isValidRoomId(token) && hits.includes(token)) {
          resolved = token;
        } else {
          unresolved.push(token);
          continue;
        }
      } else if (isValidRoomId(token)) {
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
 * Resolve add/edit tokens into LinkEntry list, merging rules from input objects.
 * Input items may be strings (id/name) or { roomId|token, name, rules }.
 *
 * @param {unknown} raw
 * @param {Iterable<{roomid: string, name?: string}>} catalog
 * @param {string} [selfRoomId]
 * @returns {{
 *   entries: Array<{roomId: string, name?: string, rules?: object}>,
 *   unresolved: string[]
 * }}
 */
function resolveLinkedRoomEntries(raw, catalog, selfRoomId) {
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
    list = splitLinkedRoomInput(raw);
  }

  const rooms = Array.from(catalog || []);
  const byId = new Map();
  const byName = new Map();
  for (const r of rooms) {
    if (!r || !r.roomid) {
      continue;
    }
    byId.set(r.roomid, r);
    const n = String(r.name || "")
      .trim()
      .toLowerCase();
    if (!n) {
      continue;
    }
    if (!byName.has(n)) {
      byName.set(n, []);
    }
    byName.get(n).push(r.roomid);
  }

  function resolveToken(token) {
    const t = String(token || "").trim();
    if (!t) {
      return { id: null, unresolved: true };
    }
    if (isValidRoomId(t) && byId.has(t)) {
      return { id: t, unresolved: false };
    }
    const hits = byName.get(t.toLowerCase()) || [];
    if (hits.length === 1) {
      return { id: hits[0], unresolved: false };
    }
    if (hits.length > 1) {
      if (isValidRoomId(t) && hits.includes(t)) {
        return { id: t, unresolved: false };
      }
      return { id: null, unresolved: true, token: t };
    }
    if (isValidRoomId(t)) {
      return { id: t, unresolved: false };
    }
    return { id: null, unresolved: true, token: t };
  }

  const entries = [];
  const seen = new Set();
  const unresolved = [];

  for (const item of list) {
    let token;
    let nameHint;
    let rulesRaw;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      token = item.roomId || item.roomid || item.id || item.token || item.name;
      // If roomId is set use it preferentially as token
      if (item.roomId || item.roomid || item.id) {
        token = item.roomId || item.roomid || item.id;
      }
      nameHint =
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : undefined;
      rulesRaw = item.rules;
    } else {
      token = item;
    }

    const r = resolveToken(token);
    if (r.unresolved || !r.id) {
      unresolved.push(String(token || "").trim() || "?");
      continue;
    }
    if (selfRoomId && r.id === selfRoomId) {
      unresolved.push(String(token || r.id));
      continue;
    }
    if (seen.has(r.id)) {
      continue;
    }
    seen.add(r.id);

    const cat = byId.get(r.id);
    const entry = { roomId: r.id };
    const name =
      nameHint ||
      (cat && cat.name ? String(cat.name) : undefined);
    if (name) {
      entry.name = name;
    }
    const rules = normalizeLinkRules(rulesRaw);
    if (rules) {
      entry.rules = rules;
    }
    entries.push(entry);
  }

  return { entries, unresolved };
}

/**
 * @param {string[]|Array<object>} current
 * @param {string} roomId
 * @param {string} [selfRoomId]
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
 * @param {string[]|Array<object>} current
 * @param {string} roomId
 * @returns {string[]}
 */
function removeLinkedRoom(current, roomId) {
  const id = String(roomId || "").trim();
  return normalizeLinkedRooms(current).filter((x) => x !== id);
}

/**
 * Remove a link entry by room id (preserves other entries' rules).
 * @param {unknown} current
 * @param {string} roomId
 * @returns {Array<object>}
 */
function removeLinkedRoomEntry(current, roomId) {
  const id = String(roomId || "").trim();
  return normalizeLinkedRoomEntries(current).filter((e) => e.roomId !== id);
}

/**
 * Upsert a link entry (merge rules).
 * @param {unknown} current
 * @param {{roomId: string, name?: string, rules?: object}} entry
 * @param {string} [selfRoomId]
 * @returns {Array<object>}
 */
function upsertLinkedRoomEntry(current, entry, selfRoomId) {
  const next = normalizeOneLinkEntry(entry);
  if (!next) {
    throw new Error("Invalid link entry");
  }
  if (selfRoomId && next.roomId === selfRoomId) {
    throw new Error("Cannot link a room to itself");
  }
  const list = normalizeLinkedRoomEntries(current).filter(
    (e) => e.roomId !== next.roomId,
  );
  list.push(next);
  return list;
}

/**
 * Mark a client-facing file JSON as linked from another room.
 * @param {object} file
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
 * @param {object} file
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
 * @param {object|null|undefined} sourceConfig
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

/**
 * Status of a source for the Linking table.
 * @param {{exists?: boolean, allowCrossLinking?: boolean|unknown}} flags
 * @returns {"ok"|"denied"|"missing"}
 */
function linkSourceStatus(flags) {
  if (!flags || !flags.exists) {
    return "missing";
  }
  if (!isCrossLinkingAllowed(flags.allowCrossLinking)) {
    return "denied";
  }
  return "ok";
}

/**
 * Does this client file pass the link's include rules?
 * Empty rules → pass (all finished uploads).
 *
 * @param {object} file — client JSON (name, type, tags, uploaded)
 * @param {object|null|undefined} rules
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function fileMatchesLinkRules(file, rules, nowMs) {
  if (!file || typeof file !== "object") {
    return false;
  }
  if (isEmptyLinkRules(rules)) {
    return true;
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  if (rules.nameContains) {
    const name = String(file.name || "").toLowerCase();
    const terms = splitContainsTerms(rules.nameContains);
    // OR: filename must include at least one term
    if (!terms.length || !terms.some((t) => name.includes(t.toLowerCase()))) {
      return false;
    }
  }

  if (rules.tagContains) {
    const needle = rules.tagContains.toLowerCase();
    const tags = file.tags && typeof file.tags === "object" ? file.tags : {};
    let hit = false;
    for (const [k, v] of Object.entries(tags)) {
      if (String(k).toLowerCase().includes(needle)) {
        hit = true;
        break;
      }
      if (v != null && String(v).toLowerCase().includes(needle)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      return false;
    }
  }

  if (Array.isArray(rules.types) && rules.types.length) {
    const t = String(file.type || "")
      .trim()
      .toLowerCase();
    if (!rules.types.includes(t)) {
      return false;
    }
  }

  const uploaded = Number(file.uploaded);
  if (rules.maxAgeHours != null && Number.isFinite(rules.maxAgeHours)) {
    // File must not be older than maxAgeHours (uploaded recently enough)
    if (!Number.isFinite(uploaded)) {
      return false;
    }
    const oldestAllowed = now - rules.maxAgeHours * MS_PER_HOUR;
    if (uploaded < oldestAllowed) {
      return false;
    }
  }

  if (rules.minAgeHours != null && Number.isFinite(rules.minAgeHours)) {
    // File must be at least minAgeHours old
    if (!Number.isFinite(uploaded)) {
      return false;
    }
    const newestAllowed = now - rules.minAgeHours * MS_PER_HOUR;
    if (uploaded > newestAllowed) {
      return false;
    }
  }

  return true;
}

/**
 * Filter a list of source client files by link rules + role visibility.
 * @param {Iterable<object>} files
 * @param {object|null|undefined} rules
 * @param {string} role
 * @param {number} [nowMs]
 * @returns {object[]}
 */
function filterLinkedSourceFiles(files, rules, role, nowMs) {
  const out = [];
  for (const f of files || []) {
    if (!includeLinkedForRole(f, role)) {
      continue;
    }
    if (!fileMatchesLinkRules(f, rules, nowMs)) {
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * Serialize entries for stable compare / wire (JSON-friendly).
 * @param {unknown} raw
 * @returns {string}
 */
function serializeLinkedRoomEntries(raw) {
  return JSON.stringify(normalizeLinkedRoomEntries(raw));
}

/**
 * Human-readable rules summary for table UI.
 * @param {object|null|undefined} rules
 * @returns {string}
 */
function summarizeLinkRules(rules) {
  if (isEmptyLinkRules(rules)) {
    return "All finished files";
  }
  const parts = [];
  if (rules.nameContains) {
    const terms = splitContainsTerms(rules.nameContains);
    if (terms.length === 1) {
      parts.push(`name~"${terms[0]}"`);
    } else if (terms.length > 1) {
      parts.push(`name~(${terms.map((t) => `"${t}"`).join("|")})`);
    }
  }
  if (rules.tagContains) {
    parts.push(`tag~"${rules.tagContains}"`);
  }
  if (rules.types && rules.types.length) {
    parts.push(`type:${rules.types.join("|")}`);
  }
  if (rules.maxAgeHours != null) {
    parts.push(`≤${rules.maxAgeHours}h old`);
  }
  if (rules.minAgeHours != null) {
    parts.push(`≥${rules.minAgeHours}h old`);
  }
  return parts.join(", ") || "All finished files";
}

module.exports = {
  ROOM_ID_RE,
  LINK_FILE_TYPES,
  MS_PER_HOUR,
  isValidRoomId,
  isCrossLinkingAllowed,
  normalizeLinkedRooms,
  normalizeLinkedRoomEntries,
  normalizeLinkRules,
  splitContainsTerms,
  normalizeOneLinkEntry,
  isEmptyLinkRules,
  splitLinkedRoomInput,
  resolveLinkedRoomTokens,
  resolveLinkedRoomEntries,
  addLinkedRoom,
  removeLinkedRoom,
  removeLinkedRoomEntry,
  upsertLinkedRoomEntry,
  markLinkedClientFile,
  isLinkableSourceFile,
  includeLinkedForRole,
  sourceAllowsCrossLink,
  linkSourceStatus,
  fileMatchesLinkRules,
  filterLinkedSourceFiles,
  serializeLinkedRoomEntries,
  summarizeLinkRules,
};
