"use strict";

/**
 * Unit tests for common/sorting.js
 */

const {
  naturalSort,
  naturalCaseSort,
  sort,
  sorted,
} = require("../../common/sorting.js");

// ─────────────────────────────────────────────────────────────────────────────
// naturalSort
// ─────────────────────────────────────────────────────────────────────────────
describe("naturalSort", () => {
  test("sorts numbers naturally (2 < 10)", () => {
    const arr = ["item10", "item2", "item1"];
    arr.sort(naturalSort);
    expect(arr).toEqual(["item1", "item2", "item10"]);
  });

  test("sorts pure strings alphabetically", () => {
    const arr = ["banana", "apple", "cherry"];
    arr.sort(naturalSort);
    expect(arr).toEqual(["apple", "banana", "cherry"]);
  });

  test("equal strings return 0", () => {
    expect(naturalSort("abc", "abc")).toBe(0);
  });

  test("numeric strings go before textual ones", () => {
    const arr = ["b1", "1a", "a1"];
    arr.sort(naturalSort);
    // Numeric tokens come first
    expect(arr[0]).toBe("1a");
  });

  test("handles hex strings", () => {
    const a = naturalSort("0x0a", "0x1f");
    expect(a).toBeLessThan(0);
  });
});

describe("naturalCaseSort", () => {
  test("case-insensitive sort", () => {
    const arr = ["b", "A", "c", "B"];
    arr.sort(naturalCaseSort);
    expect(arr[0].toLowerCase()).toBe("a");
    expect(arr[1].toLowerCase()).toBe("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sort (in-place)
// ─────────────────────────────────────────────────────────────────────────────
describe("sort", () => {
  test("sorts array in-place by key", () => {
    const arr = [{ n: 3 }, { n: 1 }, { n: 2 }];
    sort(arr, (x) => x.n);
    expect(arr.map((x) => x.n)).toEqual([1, 2, 3]);
  });

  test("returns the same array reference", () => {
    const arr = [2, 1];
    expect(sort(arr)).toBe(arr);
  });

  test("empty array is safe", () => {
    expect(sort([])).toEqual([]);
  });

  test("stable sort (preserves insertion order for equal keys)", () => {
    const arr = [
      { n: 1, id: "a" },
      { n: 1, id: "b" },
    ];
    sort(arr, (x) => x.n);
    expect(arr[0].id).toBe("a");
    expect(arr[1].id).toBe("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sorted (non-mutating)
// ─────────────────────────────────────────────────────────────────────────────
describe("sorted", () => {
  test("does not mutate original array", () => {
    const arr = [3, 1, 2];
    const result = sorted(arr);
    expect(arr).toEqual([3, 1, 2]);
    expect(result).toEqual([1, 2, 3]);
  });

  test("returns a new array", () => {
    const arr = [1];
    expect(sorted(arr)).not.toBe(arr);
  });
});
