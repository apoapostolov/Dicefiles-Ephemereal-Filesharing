"use strict";

/**
 * Shareable deep-link parse/apply helpers.
 * New intents (file/filter/sort/request query or structured hash) only apply
 * when room option deepLinks is on. Bare gallery hash `#fileKey` is legacy.
 */

const SORT_MODES = Object.freeze(["newest", "largest", "expiring"]);

/**
 * @param {unknown} configValue
 * @returns {boolean}
 */
function isDeepLinksEnabled(configValue) {
  return configValue === true || configValue === 1 || configValue === "1";
}

/**
 * Parse structured hash like `#file=abc&filter=pdf` or bare `#abc` (legacy).
 * @param {string} hash — with or without leading #
 * @returns {{legacyFileKey: string|null, intents: object}}
 */
function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").trim();
  if (!raw) {
    return { legacyFileKey: null, intents: {} };
  }
  if (!raw.includes("=") && !raw.includes("&")) {
    return { legacyFileKey: raw, intents: {} };
  }
  const params = new URLSearchParams(raw);
  return { legacyFileKey: null, intents: intentsFromParams(params) };
}

/**
 * @param {string|URLSearchParams} search — `?a=1` or URLSearchParams
 * @returns {object}
 */
function parseSearch(search) {
  let params;
  if (search instanceof URLSearchParams) {
    params = search;
  } else {
    const s = String(search || "");
    params = new URLSearchParams(s.startsWith("?") ? s.slice(1) : s);
  }
  return intentsFromParams(params);
}

function intentsFromParams(params) {
  const intents = {};
  const file = params.get("file");
  if (file) {
    intents.file = file;
  }
  const filter = params.get("filter");
  if (filter != null && filter !== "") {
    intents.filter = filter;
  }
  const sort = params.get("sort");
  if (sort && SORT_MODES.includes(sort)) {
    intents.sort = sort;
  }
  const request = params.get("request");
  if (request) {
    intents.request = request;
  }
  return intents;
}

/**
 * Merge query + hash intents. When deepLinks off, only legacy bare hash file key.
 * @param {{search?: string, hash?: string, deepLinksEnabled: boolean}} opts
 * @returns {{
 *   applyIntents: boolean,
 *   legacyGalleryKey: string|null,
 *   intents: {file?: string, filter?: string, sort?: string, request?: string}
 * }}
 */
function resolveDeepLinkNavigation(opts) {
  const enabled = isDeepLinksEnabled(opts && opts.deepLinksEnabled);
  const hashPart = parseHash(opts && opts.hash);
  const searchIntents = parseSearch(opts && opts.search);
  const hashIntents = hashPart.intents || {};

  // Structured hash intents only when enabled
  const intents = enabled
    ? Object.assign({}, searchIntents, hashIntents)
    : {};

  // Query intents only when enabled
  if (!enabled) {
    // strip any accidental — already empty
  }

  return {
    applyIntents: enabled && Object.keys(intents).length > 0,
    legacyGalleryKey: hashPart.legacyFileKey,
    intents,
    deepLinksEnabled: enabled,
  };
}

/**
 * Pure apply: given current UI state, return next state for intents.
 * Does not touch DOM.
 * @param {{filter?: string, sortMode?: string, openFileKey?: string|null, openRequestKey?: string|null}} state
 * @param {{file?: string, filter?: string, sort?: string, request?: string}} intents
 * @param {boolean} apply
 * @returns {object}
 */
function applyDeepLinkIntents(state, intents, apply) {
  const next = {
    filter: state.filter || "",
    sortMode: state.sortMode || "newest",
    openFileKey: state.openFileKey || null,
    openRequestKey: state.openRequestKey || null,
  };
  if (!apply || !intents) {
    return next;
  }
  if (typeof intents.filter === "string") {
    next.filter = intents.filter;
  }
  if (intents.sort && SORT_MODES.includes(intents.sort)) {
    next.sortMode = intents.sort;
  }
  if (intents.file) {
    next.openFileKey = intents.file;
  }
  if (intents.request) {
    next.openRequestKey = intents.request;
  }
  return next;
}

/**
 * Plan open-target resolution when config may arrive before the file list.
 * Never mark open as done while files are not ready and the key is missing —
 * config-before-files must leave a pending open for the later list replace.
 *
 * @param {{
 *   openFileKey?: string|null,
 *   openRequestKey?: string|null,
 *   filesReady: boolean,
 *   openAlreadyDone?: boolean,
 *   lookup: (key: string) => {isRequest?: boolean}|null|undefined
 * }} opts
 * @returns {{
 *   tryOpenFile: string|null,
 *   tryOpenRequest: string|null,
 *   openDone: boolean
 * }}
 */
function resolveDeepLinkOpenPlan(opts) {
  const lookup = typeof opts.lookup === "function" ? opts.lookup : () => null;
  if (opts.openAlreadyDone) {
    return { tryOpenFile: null, tryOpenRequest: null, openDone: true };
  }
  const reqKey = opts.openRequestKey || null;
  const fileKey = opts.openFileKey || null;
  if (!reqKey && !fileKey) {
    return { tryOpenFile: null, tryOpenRequest: null, openDone: true };
  }
  if (reqKey) {
    const hit = lookup(reqKey);
    if (hit && hit.isRequest) {
      return { tryOpenFile: null, tryOpenRequest: reqKey, openDone: true };
    }
    // Pending until first file list is ready; then give up if still missing.
    return {
      tryOpenFile: null,
      tryOpenRequest: null,
      openDone: !!opts.filesReady,
    };
  }
  const hit = lookup(fileKey);
  if (hit && !hit.isRequest) {
    return { tryOpenFile: fileKey, tryOpenRequest: null, openDone: true };
  }
  return {
    tryOpenFile: null,
    tryOpenRequest: null,
    openDone: !!opts.filesReady,
  };
}

/**
 * Whether list intents (filter/sort) should run now.
 * @param {{listAlreadyApplied?: boolean, applyIntents: boolean}} opts
 * @returns {boolean}
 */
function shouldApplyDeepLinkListIntents(opts) {
  return !!(opts && opts.applyIntents && !opts.listAlreadyApplied);
}

module.exports = {
  SORT_MODES,
  isDeepLinksEnabled,
  parseHash,
  parseSearch,
  resolveDeepLinkNavigation,
  applyDeepLinkIntents,
  resolveDeepLinkOpenPlan,
  shouldApplyDeepLinkListIntents,
};
