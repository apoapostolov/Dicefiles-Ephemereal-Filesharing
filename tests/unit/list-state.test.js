"use strict";

const {
  sortFiles,
  compareFiles,
  SORT_MODES,
  VIEW_MODES,
  nextSortMode,
  normalizeSortMode,
  normalizeViewMode,
  serializeFilterState,
  parseFilterState,
  collectFilterButtonState,
  applyFilterButtonState,
} = require("../../client/files/list-state");

describe("list-state (shipped)", () => {
  test("SORT_MODES includes newest/largest/expiring", () => {
    expect(SORT_MODES).toEqual(["newest", "largest", "expiring"]);
  });

  test("VIEW_MODES includes list/gallery/links", () => {
    expect(VIEW_MODES).toEqual(["list", "gallery", "links"]);
  });

  test("sortFiles by largest", () => {
    const files = [
      { size: 10, uploaded: 1, expires: 9 },
      { size: 30, uploaded: 2, expires: 8 },
      { size: 20, uploaded: 3, expires: 7 },
    ];
    const sorted = sortFiles(files, "largest");
    expect(sorted.map((f) => f.size)).toEqual([30, 20, 10]);
  });

  test("compareFiles newest", () => {
    expect(
      compareFiles({ uploaded: 5 }, { uploaded: 2 }, "newest"),
    ).toBeLessThan(0);
  });

  test("normalizeSortMode accepts known modes and falls back", () => {
    expect(normalizeSortMode("largest")).toBe("largest");
    expect(normalizeSortMode("expiring")).toBe("expiring");
    expect(normalizeSortMode("newest")).toBe("newest");
    expect(normalizeSortMode("nope")).toBe("newest");
    expect(normalizeSortMode(null, "largest")).toBe("largest");
    expect(normalizeSortMode(undefined, "bogus")).toBe("newest");
  });

  test("nextSortMode cycles", () => {
    expect(nextSortMode("newest")).toBe("largest");
    expect(nextSortMode("largest")).toBe("expiring");
    expect(nextSortMode("expiring")).toBe("newest");
    expect(nextSortMode("x")).toBe("newest");
  });

  test("normalizeViewMode", () => {
    expect(normalizeViewMode("gallery")).toBe("gallery");
    expect(normalizeViewMode("list")).toBe("list");
    expect(normalizeViewMode("links")).toBe("links");
    expect(normalizeViewMode("tiles")).toBeNull();
  });

  test("serializeFilterState + parseFilterState round-trip", () => {
    const raw = serializeFilterState({
      buttons: { image: true, video: false, document: true },
      query: "hello",
      showingNewOnly: true,
    });
    expect(typeof raw).toBe("string");
    const parsed = parseFilterState(raw);
    expect(parsed).toEqual({
      buttons: { image: true, video: false, document: true },
      query: "hello",
      showingNewOnly: true,
    });
  });

  test("parseFilterState rejects garbage", () => {
    expect(parseFilterState(null)).toBeNull();
    expect(parseFilterState("")).toBeNull();
    expect(parseFilterState("{")).toBeNull();
    expect(parseFilterState("null")).toBeNull();
    expect(parseFilterState('"x"')).toBeNull();
  });

  test("parseFilterState coerces partial objects", () => {
    expect(parseFilterState("{}")).toEqual({
      buttons: {},
      query: "",
      showingNewOnly: false,
    });
    expect(
      parseFilterState(JSON.stringify({ query: 12, buttons: { a: 1 } })),
    ).toEqual({
      buttons: { a: true },
      query: "",
      showingNewOnly: false,
    });
  });

  test("collectFilterButtonState from element-like objects", () => {
    const buttons = [
      {
        id: "filter-image",
        classList: { contains: (c) => c === "disabled" && false },
      },
      {
        id: "filter-video",
        classList: { contains: (c) => c === "disabled" },
      },
      { id: "filter-audio", classList: { contains: () => false } },
    ];
    // first: never disabled → enabled true
    // second: contains("disabled") true → enabled false
    expect(collectFilterButtonState(buttons)).toEqual({
      image: true,
      video: false,
      audio: true,
    });
  });

  test("applyFilterButtonState toggles disabled class", () => {
    const toggles = [];
    const buttons = [
      {
        id: "filter-image",
        classList: {
          toggle: (c, force) => toggles.push(["image", c, force]),
        },
      },
      {
        id: "filter-video",
        classList: {
          toggle: (c, force) => toggles.push(["video", c, force]),
        },
      },
    ];
    applyFilterButtonState(buttons, { image: true, video: false });
    expect(toggles).toEqual([
      ["image", "disabled", false],
      ["video", "disabled", true],
    ]);
  });
});
