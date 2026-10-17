"use strict";

/**
 * Firejail / external tool spawn helpers for media preview commands.
 */

const path = require("path");
const { spawn, spawnSync } = require("child_process");
const CONFIG = require("../config");

const JAIL = CONFIG.get("jail");
const PROFILE = path.join(__dirname, "..", "..", "jail.profile");

/** Default ceiling on collected stdout, in bytes. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** Default wall-clock ceiling for one child process, in ms. */
const DEFAULT_TIMEOUT_MS = 120000;
/** Cap kept for a child's stderr, which is only ever read for diagnostics. */
const MAX_STDERR_BYTES = 8192;

/**
 * Build a command argv, optionally wrapped in firejail.
 * @param {string[]} args - [binary, ...args]
 * @param {object} [opts]
 * @param {string} [opts.privateDir] Directory the command may read and write,
 *   exposed as the jail's private home so the tool cannot reach the rest of the
 *   filesystem. Required for anything that opens an uploaded file.
 * @returns {string[]}
 */
function maybeJail(args, opts = {}) {
  if (!JAIL) {
    return args;
  }
  const head = ["firejail", "--quiet", `--profile=${PROFILE}`];
  if (opts.privateDir) {
    head.push(`--private=${opts.privateDir}`);
  }
  head.push("--");
  return sandboxPaths([...head, ...args]);
}

// --private=DIR mounts DIR as the process's home. Its original path can be
// hidden (especially when uploads live under /home), so absolute file arguments
// must address that mount. Use relative paths and start in DIR: these also work
// on hosts where Firejail detects an existing sandbox and preserves the cwd.
// Keep flags and unrelated paths unchanged.
function sandboxPaths(args) {
  const privateFlag = args.find(arg => arg.startsWith("--private="));
  if (!privateFlag) {
    return args;
  }
  const source = path.resolve(privateFlag.slice("--private=".length));
  return args.map(arg => {
    if (arg === privateFlag) {
      return `--private=${source}`;
    }
    if (!path.isAbsolute(arg) || arg !== source && !arg.startsWith(`${source}${path.sep}`)) {
      return arg;
    }
    return `.${path.sep}${path.relative(source, arg)}`;
  });
}

function privateDirectory(args) {
  if (args[0] !== "firejail") {
    return undefined;
  }
  const flag = args.find(arg => arg.startsWith("--private="));
  return flag ? flag.slice("--private=".length) : undefined;
}

/**
 * Add the jail to a command argv, unless the caller already did it.
 *
 * Some preview paths build the firejail prefix inline; wrapping those again
 * would mean a firejail inside a firejail.
 *
 * @param {string[]} args
 * @param {object} [opts] see {@link maybeJail}
 * @returns {string[]}
 */
function wrapArgs(args, opts = {}) {
  return args[0] === "firejail" ? sandboxPaths(args) : maybeJail(args, opts);
}

/**
 * Spawn a jailed command and collect its stdout under a byte cap and a
 * wall-clock timeout.
 *
 * Every external tool that opens uploaded content goes through here. The child
 * is killed the moment either limit is reached, so a decompression bomb cannot
 * fill a worker's memory and a wedged parser cannot pin one indefinitely.
 *
 * @param {string[]} args - [binary, ...args], already including every flag
 * @param {object} [opts]
 * @param {number} [opts.maxBytes] stdout ceiling in bytes
 * @param {number} [opts.timeoutMs] wall-clock ceiling in ms
 * @param {string} [opts.privateDir] jail private home for file-touching tools
 * @param {AbortSignal} [opts.signal] Cancel an active native job.
 * @param {boolean} [opts.processGroup] Kill helper descendants with the job.
 * @returns {Promise<{code:number|null, stdout:Buffer, stderr:string,
 *   truncated:boolean, timedOut:boolean}>}
 */
function spawnBounded(args, opts = {}) {
  opts.signal?.throwIfAborted();
  if (CONFIG.get("nativeTools") === false) {
    throw new Error("Native file tools are disabled by this deployment. Ask the site operator about preview support.");
  }
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const argv = wrapArgs(args, { privateDir: opts.privateDir });
  const [cmd, ...rest] = argv;

  return new Promise((resolve, reject) => {
    let settled = false;
    let truncated = false;
    let timedOut = false;
    let size = 0;
    let stderr = "";
    const chunks = [];
    const child = spawn(cmd, rest, { cwd: privateDirectory(argv), detached: !!opts.processGroup && process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const kill = () => {
      if (opts.processGroup && child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        }
        catch (_) { /* The process group may already have exited. */ }
      }
      else if (opts.processGroup && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.on("error", () => child.kill("SIGKILL"));
      }
      else {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    opts.signal?.addEventListener("abort", kill, { once: true });
    if (opts.signal?.aborted) {
      kill();
    }
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      fn(value);
    };

    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        truncated = true;
        kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });
    child.on("error", err => settle(reject, err));
    child.on("close", code => {
      settle(resolve, {
        code,
        stdout: Buffer.concat(chunks),
        stderr,
        truncated,
        timedOut,
      });
    });
  });
}

/**
 * Spawn a process with optional jail, returning a Promise of {code, stdout, stderr}.
 * @param {string[]} args
 * @param {object} [opts]
 */
function spawnJailed(args, opts = {}) {
  if (CONFIG.get("nativeTools") === false) {
    throw new Error("Native file tools are disabled by this deployment.");
  }
  const argv = maybeJail(args);
  const [cmd, ...rest] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, rest, Object.assign({ encoding: "utf8" }, opts));
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", d => {
        stdout += d;
      });
    }
    if (child.stderr) {
      child.stderr.on("data", d => {
        stderr += d;
      });
    }
    child.on("error", reject);
    child.on("close", code => {
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
  wrapArgs,
  spawnBounded,
  spawnJailed,
  hasBinary,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
};
