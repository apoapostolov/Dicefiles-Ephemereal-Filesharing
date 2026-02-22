"use strict";

require("./lib/loglevel").patch();
const config = require("./lib/config");
const cluster = require("cluster");

const EXPIRATION_WORKER = "DICEFILES_EXPIRATION_WORKER";

function master() {
  console.log(`Master ${process.pid.toString().bold} is running`);

  // P0.5 — 3.1: Warn when the secret is a known default or too short.
  // Does NOT block startup — advisory only for existing deployments.
  const _secret = config.get("secret");
  const _weakSecrets = new Set([
    "dicefiles",
    "secret",
    "changeme",
    "changethis",
    "placeholder",
  ]);
  if (
    !_secret ||
    _weakSecrets.has(String(_secret).toLowerCase()) ||
    String(_secret).length < 16
  ) {
    console.warn(
      "[security] WEAK OR DEFAULT SECRET in use. Set a unique secret ≥16 chars in your .config.json before deploying to production.",
    );
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

  console.log(`Point your browser to http://0.0.0.0:${config.get("port")}/`);
}

if (cluster.isMaster) {
  master();
} else if (process.env[EXPIRATION_WORKER]) {
  require("./lib/expiration");
} else {
  require("./lib/httpserver");
}
