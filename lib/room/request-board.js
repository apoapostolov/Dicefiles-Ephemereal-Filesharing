"use strict";

/**
 * Request board list helpers — pure, over existing request file objects.
 */

/**
 * @param {object} file
 * @returns {boolean}
 */
function isRequestFile(file) {
  return !!(file && file.meta && file.meta.request);
}

/**
 * @param {object} file
 * @returns {"open"|"fulfilled"|string}
 */
function requestStatus(file) {
  if (!isRequestFile(file)) {
    return "";
  }
  const s = file.status || (file.meta && file.meta.status) || "open";
  return s === "fulfilled" ? "fulfilled" : "open";
}

/**
 * Build a board list: open first (newest), then fulfilled (newest).
 * @param {Iterable<object>} files
 * @param {{status?: "open"|"fulfilled"|"all", allowRequests?: boolean}} [opts]
 * @returns {object[]}
 */
function buildRequestBoard(files, opts = {}) {
  if (opts.allowRequests === false) {
    return [];
  }
  const statusFilter = opts.status || "all";
  const list = Array.from(files || []).filter(isRequestFile);
  const filtered =
    statusFilter === "all"
      ? list
      : list.filter((f) => requestStatus(f) === statusFilter);

  filtered.sort((a, b) => {
    const sa = requestStatus(a);
    const sb = requestStatus(b);
    if (sa !== sb) {
      // open before fulfilled
      if (sa === "open") {
        return -1;
      }
      if (sb === "open") {
        return 1;
      }
    }
    return (Number(b.uploaded) || 0) - (Number(a.uploaded) || 0);
  });
  return filtered;
}

/**
 * Summary counts for UI chrome.
 * @param {Iterable<object>} files
 * @returns {{open: number, fulfilled: number, total: number}}
 */
function summarizeRequestBoard(files) {
  let open = 0;
  let fulfilled = 0;
  for (const f of files || []) {
    if (!isRequestFile(f)) {
      continue;
    }
    if (requestStatus(f) === "fulfilled") {
      fulfilled++;
    } else {
      open++;
    }
  }
  return { open, fulfilled, total: open + fulfilled };
}

module.exports = {
  isRequestFile,
  requestStatus,
  buildRequestBoard,
  summarizeRequestBoard,
};
