"use strict";

const {
  sortFiles,
  compareFiles,
  SORT_MODES,
} = require("../../client/files/list-state");

describe("list-state (shipped)", () => {
  test("SORT_MODES includes newest/largest/expiring", () => {
    expect(SORT_MODES).toEqual(["newest", "largest", "expiring"]);
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
});
