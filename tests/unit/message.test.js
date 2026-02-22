"use strict";

/**
 * Unit tests for common/message.js — normalizeURL and toMessage.
 *
 * toMessage is async; it receives a URL constructor, a resolveRoom fn and a
 * resolveFile fn as injected dependencies — we stub those in tests.
 */

const { normalizeURL, toMessage } = require("../../common/message.js");
const { URL } = require("url");

// ─────────────────────────────────────────────────────────────────────────────
// normalizeURL
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeURL", () => {
  test("adds https:// when no scheme", () => {
    const result = normalizeURL(URL, "example.com");
    expect(result).toMatch(/^https:\/\//);
  });

  test("preserves existing https scheme", () => {
    const result = normalizeURL(URL, "https://example.com/path");
    expect(result).toMatch(/^https:\/\//);
  });

  test("preserves http scheme", () => {
    const result = normalizeURL(URL, "http://insecure.example.com/");
    expect(result).toMatch(/^http:\/\//);
  });

  test("strips username and password", () => {
    const result = normalizeURL(URL, "https://user:pass@example.com/");
    expect(result).not.toContain("user:");
    expect(result).not.toContain("pass@");
  });

  test("returns a string", () => {
    expect(typeof normalizeURL(URL, "example.com")).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toMessage
// ─────────────────────────────────────────────────────────────────────────────
describe("toMessage", () => {
  const noRoom = async () => null;
  const noFile = () => null;

  test("plain text produces a text token", async () => {
    const parts = await toMessage(URL, noRoom, noFile, "hello world");
    expect(parts.length).toBeGreaterThan(0);
    const textParts = parts.filter((p) => p.t === "t");
    const joined = textParts.map((p) => p.v).join("");
    expect(joined).toContain("hello world");
  });

  test("URL produces a url token", async () => {
    const parts = await toMessage(
      URL,
      noRoom,
      noFile,
      "check https://example.com out",
    );
    const urlPart = parts.find((p) => p.t === "u");
    expect(urlPart).not.toBeUndefined();
    expect(urlPart.v).toContain("example.com");
  });

  test("room reference produces a room token when resolved", async () => {
    const resolveRoom = async (id) => ({ v: id, n: `Room ${id}` });
    const parts = await toMessage(URL, resolveRoom, noFile, "#someroom");
    const roomPart = parts.find((p) => p.t === "r");
    expect(roomPart).not.toBeUndefined();
    expect(roomPart.v).toBe("someroom");
  });

  test("unresolvable room reference falls back to text", async () => {
    const parts = await toMessage(URL, noRoom, noFile, "#noroom");
    const textPart = parts.find((p) => p.t === "t" && p.v.includes("noroom"));
    expect(textPart).not.toBeUndefined();
  });

  test("file reference produces a file token when resolved", async () => {
    const resolveFile = () => ({
      key: "abc123",
      name: "file.png",
      type: "image",
      href: "/g/abc123",
    });
    const parts = await toMessage(URL, noRoom, resolveFile, "@abc123");
    const filePart = parts.find((p) => p.t === "f");
    expect(filePart).not.toBeUndefined();
  });

  test("message too long throws", async () => {
    const longMsg = "a".repeat(301);
    await expect(toMessage(URL, noRoom, noFile, longMsg)).rejects.toThrow(
      "Message too long",
    );
  });

  test("empty message after trim produces empty array", async () => {
    const parts = await toMessage(URL, noRoom, noFile, "   ");
    expect(parts).toEqual([]);
  });

  test("newline token collapses consecutive breaks", async () => {
    // Two newlines → at most 1 break token
    const parts = await toMessage(URL, noRoom, noFile, "line1\n\nline2");
    const breaks = parts.filter((p) => p.t === "b");
    expect(breaks.length).toBeLessThanOrEqual(1);
  });
});
