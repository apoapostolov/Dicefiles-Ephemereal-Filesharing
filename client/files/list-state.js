"use strict";

/** Pure list/sort/filter state helpers for the room file browser. */

const SORT_MODES = Object.freeze(["newest", "largest", "expiring"]);

function nextSortMode(current) {
  const i = SORT_MODES.indexOf(current);
  return SORT_MODES[(i + 1) % SORT_MODES.length] || "newest";
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
  arr.sort((a, b) => compareFiles(a, b, mode));
  return arr;
}

module.exports = {
  SORT_MODES,
  nextSortMode,
  compareFiles,
  sortFiles,
};
