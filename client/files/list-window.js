"use strict";

const {
  computeWindow,
  shouldVirtualize,
  sliceWindow,
} = require("./windowing");

/**
 * Full filtered file list for virtualization.
 * NEVER use owner.visible here — that only reflects currently mounted DOM rows
 * and collapses the total after the first window is applied.
 *
 * @param {object} owner - Files controller instance
 * @param {Iterable|null|undefined} files - optional explicit list (e.g. this.files)
 * @returns {Array}
 */
function fullFilteredList(owner, files) {
  const source =
    files != null
      ? files
      : owner.files != null
        ? owner.files
        : [];
  if (typeof owner.filtered === "function") {
    return Array.from(owner.filtered(source));
  }
  return Array.from(source);
}

/**
 * Compute which file rows should be mounted for the current scroll position.
 * @param {object} owner - Files controller instance
 * @param {Iterable|null} [files] - full source list (defaults to owner.files)
 */
function getVisibleWindow(owner, files = null) {
  const list = fullFilteredList(owner, files);
  const total = list.length;
  if (!shouldVirtualize(total) || owner.galleryMode || owner.linksMode) {
    return {
      items: list,
      start: 0,
      end: total,
      offsetY: 0,
      totalHeight: 0,
      virtualized: false,
    };
  }
  const rowHeight = owner._rowHeightHint || 52;
  const viewportHeight = (owner.el && owner.el.clientHeight) || 600;
  const scrollTop = (owner.el && owner.el.scrollTop) || 0;
  const win = computeWindow({
    total,
    scrollTop,
    viewportHeight,
    rowHeight,
    overscan: 10,
  });
  return {
    items: sliceWindow(list, win),
    start: win.start,
    end: win.end,
    offsetY: win.offsetY,
    totalHeight: win.totalHeight,
    virtualized: true,
  };
}

module.exports = {
  getVisibleWindow,
  fullFilteredList,
};
