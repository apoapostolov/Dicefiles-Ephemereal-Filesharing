"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

function applyLegacyAliases(env) {
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("DICEFILES_")) {
      const currentKey = `HOBBYFILES_${key.slice("DICEFILES_".length)}`;
      if (env[currentKey] === undefined) env[currentKey] = value;
    }
  }
  return env;
}

function loadEnvironment(directory = process.cwd(), env = process.env) {
  applyLegacyAliases(env);
  const selectedEnvFile = env.HOBBYFILES_ENV_FILE || env.DICEFILES_ENV_FILE;
  const file = selectedEnvFile ? path.resolve(directory, selectedEnvFile) : path.join(directory, ".env");
  try {
    if (!fs.existsSync(file)) {
      if (selectedEnvFile) {
        throw new Error("Selected environment file is missing");
      }
      return env;
    }
    if (fs.statSync(file).size > 1024 * 1024) {
      throw new Error("Hobbyfiles environment file must be smaller than 1 MiB");
    }
    const values = applyLegacyAliases(parseEnv(fs.readFileSync(file, "utf8")));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined) {
        env[key] = value;
      }
    }
  }
  catch (error) {
    if (error.code !== "ENOENT" || selectedEnvFile) {
      throw new Error("Cannot load Hobbyfiles environment file. Check HOBBYFILES_ENV_FILE, file size and read permissions.");
    }
  }
  applyLegacyAliases(env);
  return env;
}

const FIELDS = {
  HTTP_PORT: ["port", "port"], HTTPS_PORT: ["tlsport", "port"],
  HOBBYFILES_WORKERS: ["workers", "workers"], HOBBYFILES_SECRET: ["secret", "string"],
  HOBBYFILES_NAME: ["name", "string"], HOBBYFILES_MOTTO: ["motto", "string"],
  HOBBYFILES_UPLOADS: ["uploads", "string"], HOBBYFILES_PUBLIC_BASE_URL: ["publicBaseUrl", "string"],
  REDIS_URL: ["redis_url", "string"], HOBBYFILES_JAIL: ["jail", "boolean"],
  HOBBYFILES_NATIVE_TOOLS: ["nativeTools", "boolean"],
  HOBBYFILES_TORRENT_DISCOVERY: ["torrentDiscovery", "boolean"],
  HOBBYFILES_TORRENT_MONITOR: ["torrentMonitor", "boolean"],
  HOBBYFILES_MOVIE_AUTO_MATCH: ["movieAutoMatch", "boolean"],
  HOBBYFILES_TORRENT_PLAYBACK: ["torrentPlayback", "boolean"],
  HOBBYFILES_TMDB_TOKEN: ["tmdbToken", "string"], HOBBYFILES_TMDB_API_KEY: ["tmdbApiKey", "string"],
  HOBBYFILES_TVDB_API_KEY: ["tvdbApiKey", "string"], HOBBYFILES_TVDB_PIN: ["tvdbPin", "string"],
  HOBBYFILES_TRAKT_CLIENT_ID: ["traktClientId", "string"],
  HOBBYFILES_PUBLIC_ROOMS: ["publicRooms", "boolean"], HOBBYFILES_LINK_COLLECTION: ["linkCollection", "boolean"],
  HOBBYFILES_STATUS_PRIVATE: ["statusPagePrivate", "boolean"], HOBBYFILES_STATUS_TOKEN: ["statusPageToken", "string"],
  HOBBYFILES_GIPHY_API_KEY: ["giphyApiKey", "string"], HOBBYFILES_OPENGRAPH_API_KEY: ["opengraphIoKey", "string"],
  HOBBYFILES_AUTOMATION_KEYS: ["automationApiKeys", "array"],
  HOBBYFILES_PLUGIN_CONNECTIONS: ["pluginConnections", "array"],
};

function applyEnvironment(config, env = process.env) {
  applyLegacyAliases(env);
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

module.exports = { loadEnvironment, applyEnvironment, applyLegacyAliases, FIELDS };
