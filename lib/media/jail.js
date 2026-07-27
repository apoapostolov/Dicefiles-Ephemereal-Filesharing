"use strict";

/**
 * Firejail / external tool spawn helpers for media preview commands.
 */

const path = require("path");
const { spawn, spawnSync } = require("child_process");
const CONFIG = require("../config");

const JAIL = CONFIG.get("jail");
const PROFILE = path.join(__dirname, "..", "..", "jail.profile");

/**
 * Build a command argv, optionally wrapped in firejail.
 * @param {string[]} args - [binary, ...args]
 * @returns {string[]}
 */
function maybeJail(args) {
  if (!JAIL) {
    return args;
  }
  return [
    "firejail",
    "--quiet",
    `--profile=${PROFILE}`,
    "--",
    ...args,
  ];
}

/**
 * Spawn a process with optional jail, returning a Promise of {code, stdout, stderr}.
 * @param {string[]} args
 * @param {object} [opts]
 */
function spawnJailed(args, opts = {}) {
  const argv = maybeJail(args);
  const [cmd, ...rest] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, rest, Object.assign({ encoding: "utf8" }, opts));
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (d) => {
        stdout += d;
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        stderr += d;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function hasBinary(name) {
  try {
    return spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0 ||
      spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0 ||
      spawnSync("which", [name], { stdio: "ignore" }).status === 0;
  }
  catch (_e) {
    return false;
  }
}

module.exports = {
  JAIL,
  PROFILE,
  maybeJail,
  spawnJailed,
  hasBinary,
};
