"use strict";

const crypto = require("crypto");
const fs = require("fs");

const STATUS_TOKEN_PATTERN = /^[a-f0-9]{48,128}$/i;

function readConfigFile(configPath, fileSystem = fs) {
  if (!fileSystem.existsSync(configPath)) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(fileSystem.readFileSync(configPath, "utf8"));
  }
  catch (ex) {
    throw new Error(
      `Cannot generate status page token: ${configPath} is not valid JSON`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Cannot generate status page token: ${configPath} must contain an object`,
    );
  }
  return parsed;
}

function ensureStatusPageToken(config, options = {}) {
  if (config.get("statusPagePrivate") === false) {
    return null;
  }

  const existing = String(config.get("statusPageToken") || "").trim();
  if (existing) {
    if (!STATUS_TOKEN_PATTERN.test(existing)) {
      throw new Error(
        "statusPageToken must contain 48-128 hexadecimal characters",
      );
    }
    return existing;
  }

  const {
    configPath,
    fileSystem = fs,
    randomBytes = crypto.randomBytes,
  } = options;
  if (!configPath) {
    throw new Error("A local config path is required for status page security");
  }
  const generated = randomBytes(24).toString("hex");
  const local = readConfigFile(configPath, fileSystem);
  local.statusPageToken = generated;

  const temporaryPath = `${configPath}.status-${process.pid}.tmp`;
  fileSystem.writeFileSync(
    temporaryPath,
    `${JSON.stringify(local, null, 2)}\n`,
    { mode: 0o600 },
  );
  fileSystem.renameSync(temporaryPath, configPath);
  try {
    fileSystem.chmodSync(configPath, 0o600);
  }
  catch (_ex) {
    // Some mounted Windows filesystems do not expose POSIX permissions.
  }

  config.set("statusPageToken", generated);
  console.log(
    `[security] Generated a protected status-page link in ${configPath}`,
  );
  return generated;
}

module.exports = {
  STATUS_TOKEN_PATTERN,
  ensureStatusPageToken,
  readConfigFile,
};
