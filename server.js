// Node version guard — must run before any require() to surface version mismatches early.
{
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 20) {
    process.stderr.write(
      `ERROR: Node.js 20+ required, found ${process.versions.node}\n`,
    );
    process.exit(1);
  }
}

("use strict");

require("./lib/loglevel").patch();
const config = require("./lib/config");
const cluster = require("cluster");
const { execFileSync } = require("child_process");

const EXPIRATION_WORKER = "DICEFILES_EXPIRATION_WORKER";

function master() {
  console.log(`Master ${process.pid.toString().bold} is running`);

  // Block startup in production when secret is weak/default.
  // In development, emit a warning so local setups aren't blocked.
  const _secret = config.get("secret");
  const _weakSecrets = new Set([
    "dicefiles",
    "secret",
    "changeme",
    "changethis",
    "placeholder",
  ]);
  const _isWeakSecret =
    !_secret ||
    _weakSecrets.has(String(_secret).toLowerCase()) ||
    String(_secret).length < 16;

  if (_isWeakSecret) {
    const msg =
      "[security] Weak or default secret detected. " +
      "Set a unique secret ≥16 chars in .config.json (see README § Secret Management). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
    if (process.env.NODE_ENV === "production") {
      console.error(`[security] FATAL: ${msg}`);
      process.exit(1);
    } else {
      console.warn(`[security] WARN: ${msg}`);
    }
  }

  // Validate Firejail sandbox availability at startup.
  // Firejail is enabled by default on Linux (config.jail === true).
  // Log clearly if it is active, missing, or intentionally disabled.
  if (config.get("jail")) {
    try {
      execFileSync("firejail", ["--version"], { stdio: "ignore" });
      console.log(
        "[security] Firejail sandbox: active (jail=true, binary found)",
      );
    } catch (_e) {
      console.warn(
        "[security] Firejail sandbox: DISABLED — jail=true in config but the " +
          "'firejail' binary was not found on PATH. " +
          "Preview commands will run without sandboxing. " +
          'Install firejail or set { "jail": false } to suppress this warning.',
      );
    }
  } else {
    console.log("[security] Firejail sandbox: disabled (jail=false)");
  }

  // Fork workers.
  const WORKERS = config.get("workers");
  console.log(`Starting ${WORKERS.toString().bold} http workers`);
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  // Fork the file expiration worker
  cluster.fork(
    Object.assign({}, process.env, {
      [EXPIRATION_WORKER]: 1,
    }),
  );

  const _port = config.get("port");
  const _tls = config.get("tls");
  const _tlsport = config.get("tlsport");
  if (_tls) {
    console.log(
      `Point your browser to https://0.0.0.0:${_tlsport}/ (HTTP on ${_port})`,
    );
  } else {
    console.log(`Point your browser to http://0.0.0.0:${_port}/`);
  }
}

if (cluster.isMaster) {
  master();
} else if (process.env[EXPIRATION_WORKER]) {
  require("./lib/expiration");
} else {
  require("./lib/httpserver");
}
