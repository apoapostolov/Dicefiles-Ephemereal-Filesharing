"use strict";

/**
 * Unit tests for common/iter.js
 */

const { iter, riter } = require("../../common/iter.js");

describe("iter", () => {
  test("iterates all items forward", () => {
    const result = [...iter([1, 2, 3])];
    expect(result).toEqual([1, 2, 3]);
  });

  test("wraps around when starting mid-list (forward)", () => {
    const result = [...iter([1, 2, 3], 1)];
    expect(result).toEqual([2, 3, 1]);
  });

  test("single element", () => {
    expect([...iter([42])]).toEqual([42]);
  });

  test("empty list yields nothing", () => {
    expect([...iter([])]).toEqual([]);
  });
});

describe("riter", () => {
  test("iterates all items in reverse", () => {
    const result = [...riter([1, 2, 3])];
    expect(result).toEqual([3, 2, 1]);
  });

  test("wraps around when starting mid-list (backward)", () => {
    const result = [...riter([1, 2, 3], 1)];
    expect(result).toEqual([2, 1, 3]);
  });

  test("empty list yields nothing", () => {
    expect([...riter([])]).toEqual([]);
  });
});
