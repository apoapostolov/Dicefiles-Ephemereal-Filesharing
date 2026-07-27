"use strict";

/** Pure list/sort/filter state helpers for the room file browser. */

const SORT_MODES = Object.freeze(["newest", "largest", "expiring"]);
const VIEW_MODES = Object.freeze(["list", "gallery", "links"]);

function nextSortMode(current) {
  const i = SORT_MODES.indexOf(current);
  return SORT_MODES[(i + 1) % SORT_MODES.length] || "newest";
}

function normalizeSortMode(mode, fallback = "newest") {
  if (typeof mode === "string" && SORT_MODES.includes(mode)) {
    return mode;
  }
  return SORT_MODES.includes(fallback) ? fallback : "newest";
}

function normalizeViewMode(mode) {
  if (typeof mode === "string" && VIEW_MODES.includes(mode)) {
    return mode;
  }
  return null;
}

function compareFiles(a, b, mode) {
  switch (mode) {
  case "largest":
    return (Number(b.size) || 0) - (Number(a.size) || 0);
  case "expiring":
    return (Number(a.expires) || 0) - (Number(b.expires) || 0);
  case "newest":
  default:
    return (Number(b.uploaded) || 0) - (Number(a.uploaded) || 0);
  }
}

function sortFiles(files, mode) {
  const arr = Array.from(files || []);
  arr.sort((a, b) => compareFiles(a, b, normalizeSortMode(mode)));
  return arr;
}

/**
 * Serialize room filter chrome for localStorage.
 * @param {{buttons?: Record<string, boolean>, query?: string, showingNewOnly?: boolean}} state
 * @returns {string}
 */
function serializeFilterState(state) {
  const src = state && typeof state === "object" ? state : {};
  const buttons = {};
  if (src.buttons && typeof src.buttons === "object") {
    for (const [k, v] of Object.entries(src.buttons)) {
      if (typeof k === "string" && k) {
        buttons[k] = !!v;
      }
    }
  }
  return JSON.stringify({
    v: 1,
    buttons,
    query: typeof src.query === "string" ? src.query : "",
    showingNewOnly: !!src.showingNewOnly,
  });
}

/**
 * Parse persisted filter state. Returns null if missing/invalid.
 * @param {string|null|undefined} raw
 * @returns {{buttons: Record<string, boolean>, query: string, showingNewOnly: boolean}|null}
 */
function parseFilterState(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const buttons = {};
  if (parsed.buttons && typeof parsed.buttons === "object") {
    for (const [k, v] of Object.entries(parsed.buttons)) {
      if (typeof k === "string" && k) {
        buttons[k] = !!v;
      }
    }
  }
  return {
    buttons,
    query: typeof parsed.query === "string" ? parsed.query : "",
    showingNewOnly: !!parsed.showingNewOnly,
  };
}

/**
 * Collect enabled-map from filter button elements (id filter-image → image).
 * Enabled = not disabled class.
 * @param {Iterable<{id?: string, classList?: {contains: (c: string) => boolean}}>} buttons
 * @returns {Record<string, boolean>}
 */
function collectFilterButtonState(buttons) {
  const out = {};
  for (const b of buttons || []) {
    if (!b || !b.id) {
      continue;
    }
    const key = String(b.id).replace(/^filter-/, "");
    if (!key) {
      continue;
    }
    const disabled =
      b.classList && typeof b.classList.contains === "function"
        ? b.classList.contains("disabled")
        : false;
    out[key] = !disabled;
  }
  return out;
}

/**
 * Apply button enabled map onto elements. Missing keys leave the button alone.
 * @param {Iterable<{id?: string, classList?: {toggle: (c: string, force?: boolean) => void}}>} buttons
 * @param {Record<string, boolean>|null|undefined} enabledMap
 */
function applyFilterButtonState(buttons, enabledMap) {
  if (!enabledMap || typeof enabledMap !== "object") {
    return;
  }
  for (const b of buttons || []) {
    if (!b || !b.id || !b.classList || typeof b.classList.toggle !== "function") {
      continue;
    }
    const key = String(b.id).replace(/^filter-/, "");
    if (!Object.prototype.hasOwnProperty.call(enabledMap, key)) {
      continue;
    }
    b.classList.toggle("disabled", !enabledMap[key]);
  }
}

module.exports = {
  SORT_MODES,
  VIEW_MODES,
  nextSortMode,
  normalizeSortMode,
  normalizeViewMode,
  compareFiles,
  sortFiles,
  serializeFilterState,
  parseFilterState,
  collectFilterButtonState,
  applyFilterButtonState,
};
