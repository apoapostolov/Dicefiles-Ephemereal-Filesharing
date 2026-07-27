"use strict";

require("../../lib/colors-shim");

describe("colors-shim", () => {
  test("supports chained style accessors used by loglevel", () => {
    const s = "hello".bold.blue;
    expect(String(s)).toContain("hello");
    expect(String("warn".yellow).length).toBeGreaterThan(0);
    expect(String("x".red.bold)).toContain("x");
  });
});
