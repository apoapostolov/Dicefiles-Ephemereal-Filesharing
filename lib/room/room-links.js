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
 *     visibility?: string,    // all | authenticated | members | owners | mods
 *     allowPrivateSource?: boolean,
 *     rules?: LinkRules
 *   }
 *   LinkRules: {
 *     nameContains?: string,  // filename expression: comma/OR, AND, /regex/flags
 *     tagContains?: string,   // expression matched against tag keys and values
 *     userContains?: string,  // expression matched against uploader usernames
 *     types?: string[],       // allowed file.type values (image, video, …)
 *     maxAgeHours?: number,   // include only if uploaded within last N hours
 *     minAgeHours?: number,   // include only if uploaded at least N hours ago
 *   }
 *
 * Source rooms must opt in via allowCrossLinking. Invite-only sources also
 * require allowPrivateCrossLinking on the source and allowPrivateSource on the
 * destination link.
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
const MAX_LINK_RULE_EXPRESSION_LENGTH = 512;
const MAX_LINK_RULE_REGEX_LENGTH = 256;
const MAX_LINK_RULE_OPERANDS = 32;
const MAX_LINK_RULE_CANDIDATE_LENGTH = 2048;
const LINK_RULE_EXPRESSION_CACHE = new Map();
const LINK_VISIBILITIES = Object.freeze([
  "all",
  "authenticated",
  "members",
  "owners",
  "mods",
]);

function normalizeLinkVisibility(raw) {
  const value = String(raw || "all")
    .trim()
    .toLowerCase();
  return LINK_VISIBILITIES.includes(value) ? value : "all";
}

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

function normalizeRuleExpressionInput(raw) {
  if (raw == null || raw === "") {
    return "";
  }
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value || "").trim()).filter(Boolean).join(", ");
  }
  return String(raw).trim();
}

/**
 * Tokenize a linked-file expression without splitting commas/operators inside
 * slash-delimited regular expressions. AND/OR are intentionally uppercase so
 * ordinary phrases such as "rock and roll" remain plain substring searches.
 */
function tokenizeLinkRuleExpression(expression) {
  const tokens = [];
  let start = 0;
  let inRegex = false;
  let escaped = false;
  let inClass = false;

  function pushOperand(end) {
    const value = expression.slice(start, end).trim();
    if (!value) {
      throw new Error("A rule cannot contain an empty term.");
    }
    tokens.push({ type: "operand", value });
  }

  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (inRegex) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "[") {
        inClass = true;
      } else if (char === "]") {
        inClass = false;
      } else if (char === "/" && !inClass) {
        inRegex = false;
      }
      continue;
    }

    if (char === "/" && expression.slice(start, i).trim() === "") {
      inRegex = true;
      continue;
    }
    if (char === ",") {
      pushOperand(i);
      tokens.push({ type: "operator", value: "OR" });
      start = i + 1;
      continue;
    }

    for (const operator of ["AND", "OR"]) {
      if (!expression.startsWith(operator, i)) {
        continue;
      }
      const before = i === 0 ? " " : expression[i - 1];
      const after =
        i + operator.length >= expression.length
          ? " "
          : expression[i + operator.length];
      if (!/\s/.test(before) || !/\s/.test(after)) {
        continue;
      }
      pushOperand(i);
      tokens.push({ type: "operator", value: operator });
      i += operator.length - 1;
      start = i + 1;
      break;
    }
  }
  if (inRegex) {
    throw new Error("Regular expression is missing its closing slash.");
  }
  pushOperand(expression.length);
  return tokens;
}

function parseRegexOperand(value) {
  if (!value.startsWith("/")) {
    return null;
  }
  let escaped = false;
  let inClass = false;
  let closingSlash = -1;
  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (char === "/" && !inClass) {
      closingSlash = i;
      break;
    }
  }
  if (closingSlash < 0) {
    throw new Error("Regular expression is missing its closing slash.");
  }
  const source = value.slice(1, closingSlash);
  const flags = value.slice(closingSlash + 1);
  if (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) {
    throw new Error("Regex flags may use i, m, s, or u once each.");
  }
  if (source.length > MAX_LINK_RULE_REGEX_LENGTH) {
    throw new Error(
      `Regular expressions may be at most ${MAX_LINK_RULE_REGEX_LENGTH} characters.`,
    );
  }
  if (/\\(?:[1-9]|k<)/.test(source)) {
    throw new Error("Regex backreferences are not supported in linked-file rules.");
  }
  // Reject the most common catastrophic-backtracking shape: a quantified
  // group which also contains a quantified token, such as (a+)+.
  if (
    /\((?:[^()\\]|\\.)*(?:[*+]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d+(?:,\d*)?\})/.test(
      source,
    )
  ) {
    throw new Error("Regex contains an unsafe nested repetition.");
  }
  let regex;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`);
  }
  return { kind: "regex", source, flags, regex };
}

/**
 * Validate and compile a single filename/tag/uploader expression.
 * Comma and OR mean "any"; AND means "all"; AND binds before OR.
 */
function validateLinkRuleExpression(raw) {
  const normalized = normalizeRuleExpressionInput(raw);
  if (LINK_RULE_EXPRESSION_CACHE.has(normalized)) {
    return LINK_RULE_EXPRESSION_CACHE.get(normalized);
  }
  function finish(result) {
    if (LINK_RULE_EXPRESSION_CACHE.size >= 128) {
      LINK_RULE_EXPRESSION_CACHE.delete(
        LINK_RULE_EXPRESSION_CACHE.keys().next().value,
      );
    }
    LINK_RULE_EXPRESSION_CACHE.set(normalized, result);
    return result;
  }
  if (!normalized) {
    return finish({ valid: true, normalized: "", groups: [] });
  }
  if (normalized.length > MAX_LINK_RULE_EXPRESSION_LENGTH) {
    return finish({
      valid: false,
      normalized,
      error: `Rule may be at most ${MAX_LINK_RULE_EXPRESSION_LENGTH} characters.`,
    });
  }
  try {
    const tokens = tokenizeLinkRuleExpression(normalized);
    const operandCount = tokens.filter((token) => token.type === "operand").length;
    if (operandCount > MAX_LINK_RULE_OPERANDS) {
      throw new Error(`Rule may contain at most ${MAX_LINK_RULE_OPERANDS} terms.`);
    }
    const groups = [[]];
    for (const token of tokens) {
      if (token.type === "operator") {
        if (token.value === "OR") {
          groups.push([]);
        }
        continue;
      }
      const regexOperand = parseRegexOperand(token.value);
      groups[groups.length - 1].push(
        regexOperand || {
          kind: "text",
          value: token.value,
          normalized: token.value.toLowerCase(),
        },
      );
    }
    if (groups.some((group) => !group.length)) {
      throw new Error("A rule cannot contain adjacent operators.");
    }
    return finish({ valid: true, normalized, groups });
  } catch (error) {
    return finish({ valid: false, normalized, error: error.message });
  }
}

function validateLinkRules(raw) {
  const normalized = normalizeLinkRules(raw);
  const errors = {};
  for (const [field, label] of [
    ["nameContains", "Filename rule"],
    ["tagContains", "Tag rule"],
    ["userContains", "Uploader username rule"],
  ]) {
    const result = validateLinkRuleExpression(
      raw && typeof raw === "object" ? raw[field] : "",
    );
    if (!result.valid) {
      errors[field] = `${label}: ${result.error}`;
    }
  }
  return {
    valid: !Object.keys(errors).length,
    rules: normalized,
    errors,
  };
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

  for (const field of ["nameContains", "tagContains", "userContains"]) {
    let s = normalizeRuleExpressionInput(raw[field]);
    if (
      field === "nameContains" &&
      s &&
      !s.startsWith("/") &&
      !/\s(?:AND|OR)\s/.test(s)
    ) {
      s = splitContainsTerms(s).join(", ");
    }
    if (s) {
      rules[field] = s;
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
  const visibility = normalizeLinkVisibility(item.visibility);
  if (visibility !== "all") {
    entry.visibility = visibility;
  }
  if (item.allowPrivateSource === true) {
    entry.allowPrivateSource = true;
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
    let visibilityRaw;
    let allowPrivateSource = false;
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
      visibilityRaw = item.visibility;
      allowPrivateSource = item.allowPrivateSource === true;
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
    const name = nameHint || (cat && cat.name ? String(cat.name) : undefined);
    if (name) {
      entry.name = name;
    }
    const ruleValidation = validateLinkRules(rulesRaw);
    if (!ruleValidation.valid) {
      throw new Error(Object.values(ruleValidation.errors).join(" "));
    }
    const rules = ruleValidation.rules;
    if (rules) {
      entry.rules = rules;
    }
    const visibility = normalizeLinkVisibility(visibilityRaw);
    if (visibility !== "all") {
      entry.visibility = visibility;
    }
    if (allowPrivateSource) {
      entry.allowPrivateSource = true;
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
 * Cross-room content policy. Request cards stay local because their requester,
 * claim, permission, and fulfillment lifecycle belongs to the source room.
 * The uploaded file that fulfills a request is a normal finished upload and
 * may mirror normally when it matches the link rules.
 *
 * @returns {"request"|"hidden"|null}
 */
function linkedContentExclusionReason(file) {
  if (!file || typeof file !== "object") {
    return "hidden";
  }
  if (file.meta && file.meta.request) {
    return "request";
  }
  if (file.hidden) {
    return "hidden";
  }
  return null;
}

/**
 * Finished upload (not a request card).
 * @param {object} file
 * @returns {boolean}
 */
function isLinkableSourceFile(file) {
  return linkedContentExclusionReason(file) === null;
}

/**
 * @param {object} file
 * @returns {boolean}
 */
function includeLinkedForRole(file) {
  // Hidden/hellbanned source rows never cross room boundaries. Moderation
  // remains in the source room, where the original context and controls exist.
  return linkedContentExclusionReason(file) === null;
}

/**
 * Per-link destination visibility ACL.
 * @param {unknown} rawVisibility
 * @param {{
 *   role?: string,
 *   authenticated?: boolean,
 *   member?: boolean,
 *   owner?: boolean
 * }} viewer
 */
function linkVisibilityAllows(rawVisibility, viewer) {
  const visibility = normalizeLinkVisibility(rawVisibility);
  const v = viewer || {};
  const isMod = v.role === "mod";
  if (isMod || visibility === "all") {
    return true;
  }
  if (visibility === "authenticated") {
    return !!v.authenticated;
  }
  if (visibility === "members") {
    return !!(v.member || v.owner);
  }
  if (visibility === "owners") {
    return !!v.owner;
  }
  return false;
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
 * Invite-only sources require a second, source-owned opt-in. This prevents a
 * destination owner from unilaterally bypassing a source room's privacy mode.
 */
function sourceAllowsPrivateCrossLink(sourceConfig) {
  if (!sourceConfig) {
    return false;
  }
  const raw =
    typeof sourceConfig.get === "function"
      ? sourceConfig.get("allowPrivateCrossLinking")
      : sourceConfig.allowPrivateCrossLinking;
  return isCrossLinkingAllowed(raw);
}

/**
 * Status of a source for the Linking table.
 * @param {{
 *   exists?: boolean,
 *   allowCrossLinking?: boolean|unknown,
 *   privateSource?: boolean,
 *   allowPrivateSource?: boolean,
 *   allowPrivateCrossLinking?: boolean|unknown
 * }} flags
 * @returns {"ok"|"denied"|"missing"|"private"}
 */
function linkSourceStatus(flags) {
  if (!flags || !flags.exists) {
    return "missing";
  }
  if (!isCrossLinkingAllowed(flags.allowCrossLinking)) {
    return "denied";
  }
  if (
    flags.privateSource &&
    (!flags.allowPrivateSource ||
      !isCrossLinkingAllowed(flags.allowPrivateCrossLinking))
  ) {
    return "private";
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

  function expressionMatches(raw, candidates) {
    const parsed = validateLinkRuleExpression(raw);
    if (!parsed.valid || !parsed.groups.length) {
      return false;
    }
    const values = candidates.map((candidate) =>
      String(candidate == null ? "" : candidate).slice(
        0,
        MAX_LINK_RULE_CANDIDATE_LENGTH,
      ),
    );
    return parsed.groups.some((group) =>
      group.every((operand) =>
        values.some((value) =>
          operand.kind === "regex"
            ? operand.regex.test(value)
            : value.toLowerCase().includes(operand.normalized),
        ),
      ),
    );
  }

  if (
    rules.nameContains &&
    !expressionMatches(rules.nameContains, [file.name || ""])
  ) {
    return false;
  }

  if (rules.tagContains) {
    const tags = file.tags && typeof file.tags === "object" ? file.tags : {};
    const candidates = [];
    for (const [k, v] of Object.entries(tags)) {
      candidates.push(k);
      if (v != null) {
        candidates.push(v);
      }
    }
    if (!expressionMatches(rules.tagContains, candidates)) {
      return false;
    }
  }

  if (rules.userContains) {
    const tags = file.tags && typeof file.tags === "object" ? file.tags : {};
    const meta = file.meta && typeof file.meta === "object" ? file.meta : {};
    const users = [
      tags.user,
      tags.usernick,
      meta.user,
      meta.usernick,
      meta.botName,
    ].filter((value) => value != null && value !== "");
    if (!expressionMatches(rules.userContains, users)) {
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
    const expression = String(rules.nameContains);
    if (expression.startsWith("/") || /\s(?:AND|OR)\s/.test(expression)) {
      parts.push(`name~"${expression}"`);
    } else {
      const terms = splitContainsTerms(expression);
      if (terms.length === 1) {
        parts.push(`name~"${terms[0]}"`);
      } else if (terms.length > 1) {
        parts.push(`name~(${terms.map((t) => `"${t}"`).join("|")})`);
      }
    }
  }
  if (rules.tagContains) {
    parts.push(`tag~"${rules.tagContains}"`);
  }
  if (rules.userContains) {
    parts.push(`uploader~"${rules.userContains}"`);
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

function summarizeLinkAccess(entry) {
  const e = entry || {};
  const visibility = normalizeLinkVisibility(e.visibility);
  const labels = {
    all: "Everyone",
    authenticated: "Signed-in users",
    members: "Room members / guests",
    owners: "Room owners",
    mods: "Moderators",
  };
  const parts = [`Visible to ${labels[visibility]}`];
  if (e.allowPrivateSource) {
    parts.push("invite-only source allowed");
  }
  return parts.join("; ");
}

module.exports = {
  ROOM_ID_RE,
  LINK_FILE_TYPES,
  LINK_VISIBILITIES,
  MS_PER_HOUR,
  normalizeLinkVisibility,
  isValidRoomId,
  isCrossLinkingAllowed,
  normalizeLinkedRooms,
  normalizeLinkedRoomEntries,
  normalizeLinkRules,
  validateLinkRuleExpression,
  validateLinkRules,
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
  linkedContentExclusionReason,
  isLinkableSourceFile,
  includeLinkedForRole,
  linkVisibilityAllows,
  sourceAllowsCrossLink,
  sourceAllowsPrivateCrossLink,
  linkSourceStatus,
  fileMatchesLinkRules,
  filterLinkedSourceFiles,
  serializeLinkedRoomEntries,
  summarizeLinkRules,
  summarizeLinkAccess,
};
