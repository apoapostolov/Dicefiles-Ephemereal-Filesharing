"use strict";

/**
 * Critical upload path pure helpers — drive the real shipped module.
 */

const { sanitizeTagValue } = require("../../lib/upload-sanitize");

describe("upload sanitizeTagValue (shipped lib/upload-sanitize.js)", () => {
  test("strips HTML tags", () => {
    expect(sanitizeTagValue("<script>alert(1)</script>hi")).toBe("alert(1) hi");
  });

  test("strips markdown images and links", () => {
    expect(sanitizeTagValue("![x](http://a) and [y](http://b)")).toBe(
      "x and y",
    );
  });

  test("truncates long values", () => {
    const long = "a".repeat(250);
    const out = sanitizeTagValue(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });

  test("nullish becomes empty string", () => {
    expect(sanitizeTagValue(null)).toBe("");
    expect(sanitizeTagValue(undefined)).toBe("");
  });
});
