"use strict";

/**
 * Drives the shipped list-window module with a Files-like owner whose
 * `visible` getter returns only the currently mounted slice — the exact
 * failure mode that made scroll re-windowing a no-op.
 */

const {
  getVisibleWindow,
  fullFilteredList,
} = require("../../client/files/list-window");

function makeOwner({ total = 500, mounted = 40, scrollTop = 0, filter = null } = {}) {
  const files = Array.from({ length: total }, (_, i) => ({
    key: `f${i}`,
    i,
    uploaded: total - i,
    size: 1000 + i,
  }));
  // Simulate DOM-mounted slice only (what owner.visible returns in production).
  let mountedSlice = files.slice(0, mounted);

  const owner = {
    files,
    galleryMode: false,
    linksMode: false,
    _rowHeightHint: 40,
    el: { clientHeight: 600, scrollTop },
    filtered(src) {
      const arr = Array.from(src || []);
      return filter ? arr.filter(filter) : arr;
    },
    get visible() {
      // BUG-shaped: only mounted DOM rows, NOT the full list.
      return mountedSlice.slice();
    },
    setMounted(slice) {
      mountedSlice = slice;
    },
  };
  return owner;
}

describe("list-window getVisibleWindow (shipped)", () => {
  test("fullFilteredList uses owner.files not owner.visible when files arg omitted", () => {
    const owner = makeOwner({ total: 500, mounted: 30 });
    expect(owner.visible.length).toBe(30);
    expect(fullFilteredList(owner, null).length).toBe(500);
    expect(fullFilteredList(owner, undefined).length).toBe(500);
  });

  test("null files arg still virtualizes when full list is large (not visible length)", () => {
    const owner = makeOwner({ total: 500, mounted: 30, scrollTop: 0 });
    // After first window, "visible" is only ~30 — old code would stop virtualizing.
    const win = getVisibleWindow(owner, null);
    expect(win.virtualized).toBe(true);
    expect(win.items.length).toBeLessThan(100);
    expect(win.items.length).toBeGreaterThan(10);
    expect(win.totalHeight).toBe(500 * 40);
  });

  test("explicit this.files arg also virtualizes large rooms", () => {
    const owner = makeOwner({ total: 500, mounted: 30, scrollTop: 2000 });
    const win = getVisibleWindow(owner, owner.files);
    expect(win.virtualized).toBe(true);
    expect(win.start).toBeGreaterThan(0);
    expect(win.count || win.items.length).toBeLessThan(80);
  });

  test("scroll change remounts a different window while visible stays the old slice", () => {
    const owner = makeOwner({ total: 500, mounted: 40, scrollTop: 0 });
    const top = getVisibleWindow(owner, owner.files);
    expect(top.virtualized).toBe(true);

    // Simulate: DOM still holds only the first window's rows.
    owner.setMounted(top.items);
    expect(owner.visible.length).toBe(top.items.length);
    expect(owner.visible.length).toBeLessThan(120);

    // User scrolls far down — must still use full 500 for total, not visible.length.
    owner.el.scrollTop = 8000;
    const mid = getVisibleWindow(owner, null); // null path = the bug path
    expect(mid.virtualized).toBe(true);
    expect(mid.start).toBeGreaterThan(top.start);
    expect(mid.items[0].i).not.toBe(top.items[0].i);
  });

  test("small full list does not virtualize", () => {
    const owner = makeOwner({ total: 50, mounted: 50 });
    const win = getVisibleWindow(owner, owner.files);
    expect(win.virtualized).toBe(false);
    expect(win.items.length).toBe(50);
  });

  test("filter is applied to full list before windowing", () => {
    const owner = makeOwner({
      total: 500,
      mounted: 20,
      filter: (f) => f.i % 2 === 0,
    });
    const win = getVisibleWindow(owner, owner.files);
    expect(win.virtualized).toBe(true);
    // 250 even items → still virtualized
    expect(win.totalHeight).toBe(250 * 40);
    win.items.forEach((f) => expect(f.i % 2).toBe(0));
  });
});
