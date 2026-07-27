"use strict";

/**
 * Pure file-list windowing helpers.
 * Used by the room file list to keep only a viewport-bounded set of rows "active".
 */

/**
 * Compute the index window for a virtualized list.
 *
 * @param {object} opts
 * @param {number} opts.total - total item count
 * @param {number} opts.scrollTop - current scroll offset in px
 * @param {number} opts.viewportHeight - visible viewport height in px
 * @param {number} opts.rowHeight - fixed row height in px (approximate ok)
 * @param {number} [opts.overscan=8] - extra rows above/below the viewport
 * @returns {{ start: number, end: number, offsetY: number, totalHeight: number, count: number }}
 */
function computeWindow({
  total,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan = 8,
}) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const rh = Math.max(1, Number(rowHeight) || 1);
  const st = Math.max(0, Number(scrollTop) || 0);
  const vh = Math.max(0, Number(viewportHeight) || 0);
  const over = Math.max(0, Math.floor(Number(overscan) || 0));

  if (t === 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, count: 0 };
  }

  const firstVisible = Math.floor(st / rh);
  const visibleCount = Math.ceil(vh / rh) + 1;
  let start = Math.max(0, firstVisible - over);
  let end = Math.min(t, firstVisible + visibleCount + over);
  if (end < start) {
    end = start;
  }
  return {
    start,
    end,
    offsetY: start * rh,
    totalHeight: t * rh,
    count: end - start,
  };
}

/**
 * Slice items for the active window.
 * @template T
 * @param {T[]} items
 * @param {{ start: number, end: number }} win
 * @returns {T[]}
 */
function sliceWindow(items, win) {
  if (!Array.isArray(items)) {
    return [];
  }
  const start = Math.max(0, win.start | 0);
  const end = Math.max(start, win.end | 0);
  return items.slice(start, end);
}

/**
 * Whether a full-render path should be used (small lists).
 * @param {number} total
 * @param {number} [threshold=120]
 */
function shouldVirtualize(total, threshold = 120) {
  return (Number(total) || 0) >= threshold;
}

module.exports = {
  computeWindow,
  sliceWindow,
  shouldVirtualize,
};
