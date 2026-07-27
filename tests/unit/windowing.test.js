"use strict";

/**
 * File-list virtualization helpers — pure functions, no DOM.
 * Drives the real shipped module: client/files/windowing.js
 */

const {
  computeWindow,
  sliceWindow,
  shouldVirtualize,
} = require("../../client/files/windowing");

describe("file list windowing", () => {
  test("computeWindow returns a viewport-bounded slice for 500 items", () => {
    const total = 500;
    const rowHeight = 40;
    const viewportHeight = 600;
    const win = computeWindow({
      total,
      scrollTop: 2000,
      viewportHeight,
      rowHeight,
      overscan: 5,
    });
    expect(win.start).toBeGreaterThanOrEqual(0);
    expect(win.end).toBeLessThanOrEqual(total);
    expect(win.count).toBe(win.end - win.start);
    // Visible (~15) + overscan*2 (10) + 1 ≈ bounded well under total
    expect(win.count).toBeLessThan(80);
    expect(win.count).toBeGreaterThan(10);
    expect(win.totalHeight).toBe(total * rowHeight);
  });

  test("sliceWindow returns only the windowed rows", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ i }));
    const win = computeWindow({
      total: 500,
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 50,
      overscan: 2,
    });
    const slice = sliceWindow(items, win);
    expect(slice.length).toBe(win.count);
    expect(slice.length).toBeLessThan(50);
    expect(slice[0].i).toBe(win.start);
  });

  test("shouldVirtualize thresholds", () => {
    expect(shouldVirtualize(50)).toBe(false);
    expect(shouldVirtualize(120)).toBe(true);
    expect(shouldVirtualize(500)).toBe(true);
  });

  test("empty list is stable", () => {
    const win = computeWindow({
      total: 0,
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: 40,
    });
    expect(win).toEqual({
      start: 0,
      end: 0,
      offsetY: 0,
      totalHeight: 0,
      count: 0,
    });
    expect(sliceWindow([], win)).toEqual([]);
  });

  test("scroll position change moves the window (re-window contract)", () => {
    const total = 500;
    const rowHeight = 40;
    const viewportHeight = 600;
    const top = computeWindow({
      total,
      scrollTop: 0,
      viewportHeight,
      rowHeight,
      overscan: 5,
    });
    const mid = computeWindow({
      total,
      scrollTop: 8000,
      viewportHeight,
      rowHeight,
      overscan: 5,
    });
    expect(mid.start).toBeGreaterThan(top.start);
    expect(mid.end).toBeGreaterThan(top.end);
    // Windows must not cover the entire list
    expect(top.count).toBeLessThan(100);
    expect(mid.count).toBeLessThan(100);
    // Distinct mounted ranges
    expect(top.start === mid.start && top.end === mid.end).toBe(false);
  });
});
