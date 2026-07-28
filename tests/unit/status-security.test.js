"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ensureStatusPageToken,
  STATUS_TOKEN_PATTERN,
} = require("../../lib/status-token");
const {
  canAccessStatus,
  statusApiHref,
  statusPageHref,
} = require("../../lib/status-access");

describe("status page capability-link security", () => {
  let temporaryDirectory;
  let configPath;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dicefiles-status-"),
    );
    configPath = path.join(temporaryDirectory, ".config.json");
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("generates and persists one stable token when protection is enabled", () => {
    fs.writeFileSync(configPath, JSON.stringify({ port: 10005 }));
    const config = new Map([
      ["statusPagePrivate", true],
      ["statusPageToken", ""],
    ]);

    const first = ensureStatusPageToken(config, { configPath });
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const second = ensureStatusPageToken(config, { configPath });

    expect(first).toMatch(STATUS_TOKEN_PATTERN);
    expect(first).toHaveLength(48);
    expect(stored.statusPageToken).toBe(first);
    expect(second).toBe(first);
  });

  test("does not generate a token when the dashboard is explicitly public", () => {
    const config = new Map([
      ["statusPagePrivate", false],
      ["statusPageToken", ""],
    ]);
    expect(ensureStatusPageToken(config, { configPath })).toBeNull();
    expect(fs.existsSync(configPath)).toBe(false);
  });

  test("rejects an invalid configured token instead of silently weakening access", () => {
    const config = new Map([
      ["statusPagePrivate", true],
      ["statusPageToken", "short-token"],
    ]);
    expect(() => ensureStatusPageToken(config, { configPath })).toThrow(
      "48-128 hexadecimal characters",
    );
  });

  test("protected mode accepts only the exact token and builds keyed routes", () => {
    const token = "a".repeat(48);
    const config = new Map([
      ["statusPagePrivate", true],
      ["statusPageToken", token],
    ]);

    expect(canAccessStatus(config, token)).toBe(true);
    expect(canAccessStatus(config, "b".repeat(48))).toBe(false);
    expect(canAccessStatus(config, "")).toBe(false);
    expect(statusPageHref(config)).toBe("");
    expect(statusPageHref(config, true)).toBe(`/status/${token}`);
    expect(statusApiHref(config, true)).toBe(`/api/public/status/${token}`);
  });

  test("public mode preserves the original unkeyed routes", () => {
    const config = new Map([["statusPagePrivate", false]]);
    expect(canAccessStatus(config, "")).toBe(true);
    expect(statusPageHref(config)).toBe("/status");
    expect(statusApiHref(config)).toBe("/api/public/status");
  });
});
