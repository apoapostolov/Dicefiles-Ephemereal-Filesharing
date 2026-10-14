"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

function loadEnvironment(directory = process.cwd(), env = process.env) {
  const file = env.DICEFILES_ENV_FILE ? path.resolve(directory, env.DICEFILES_ENV_FILE) : path.join(directory, ".env");
  try {
    if (!fs.existsSync(file)) {
      if (env.DICEFILES_ENV_FILE) {
        throw new Error("Selected environment file is missing");
      }
      return env;
    }
    if (fs.statSync(file).size > 1024 * 1024) {
      throw new Error("Dicefiles environment file must be smaller than 1 MiB");
    }
    const values = parseEnv(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined) {
        env[key] = value;
      }
    }
  }
  catch (error) {
    if (error.code !== "ENOENT" || env.DICEFILES_ENV_FILE) {
      throw new Error("Cannot load Dicefiles environment file. Check DICEFILES_ENV_FILE, file size and read permissions.");
    }
  }
  return env;
}

const FIELDS = {
  HTTP_PORT: ["port", "port"], HTTPS_PORT: ["tlsport", "port"],
  DICEFILES_WORKERS: ["workers", "workers"], DICEFILES_SECRET: ["secret", "string"],
  DICEFILES_NAME: ["name", "string"], DICEFILES_MOTTO: ["motto", "string"],
  DICEFILES_UPLOADS: ["uploads", "string"], DICEFILES_PUBLIC_BASE_URL: ["publicBaseUrl", "string"],
  REDIS_URL: ["redis_url", "string"], DICEFILES_JAIL: ["jail", "boolean"],
  DICEFILES_NATIVE_TOOLS: ["nativeTools", "boolean"],
  DICEFILES_PUBLIC_ROOMS: ["publicRooms", "boolean"], DICEFILES_LINK_COLLECTION: ["linkCollection", "boolean"],
  DICEFILES_STATUS_PRIVATE: ["statusPagePrivate", "boolean"], DICEFILES_STATUS_TOKEN: ["statusPageToken", "string"],
  DICEFILES_GIPHY_API_KEY: ["giphyApiKey", "string"], DICEFILES_OPENGRAPH_API_KEY: ["opengraphIoKey", "string"],
  DICEFILES_AUTOMATION_KEYS: ["automationApiKeys", "array"],
};

function applyEnvironment(config, env = process.env) {
  for (const [name, [key, type]] of Object.entries(FIELDS)) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      continue;
    }
    let value = raw;
    if (type === "boolean") {
      if (!/^(true|false)$/i.test(raw)) {
        throw new Error(`${name} must be true or false`);
      }
      value = raw.toLowerCase() === "true";
    }
    else if (type === "port" || type === "workers") {
      value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > (type === "port" ? 65535 : 64)) {
        throw new Error(`${name} must be an integer from 1 to ${type === "port" ? 65535 : 64}`);
      }
    }
    else if (type === "array") {
      try {
        value = JSON.parse(raw);
      }
      catch (_) {
        throw new Error(`${name} must be a JSON array`);
      }
      if (!Array.isArray(value)) {
        throw new Error(`${name} must be a JSON array`);
      }
    }
    config.set(key, value);
  }
}

module.exports = { loadEnvironment, applyEnvironment, FIELDS };
