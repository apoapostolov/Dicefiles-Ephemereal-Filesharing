"use strict";

const {
  computeWindow,
  shouldVirtualize,
  sliceWindow,
} = require("./windowing");
const { sortFiles } = require("./list-state");

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
    files != null ?
      files :
      owner.files != null ?
        owner.files :
        [];
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
  let list = sortFiles(fullFilteredList(owner, files), owner.sortMode || "newest");
  if (owner.galleryMode) {
    list = list.filter(file => !file.isRequest && !(file.meta && file.meta.request));
    const pageSize = 100;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const page = Math.max(0, Math.min(pages - 1, Number(owner.galleryPage) || 0));
    return {
      items: list.slice(page * pageSize, (page + 1) * pageSize),
      start: page * pageSize, end: Math.min(list.length, (page + 1) * pageSize),
      offsetY: 0, totalHeight: 0, virtualized: false,
      galleryPaged: true, page, pages, total: list.length,
    };
  }
  const total = list.length;
  if (!shouldVirtualize(total) || owner.linksMode) {
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
