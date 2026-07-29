#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  activateFederationRotation,
  cancelFederationRotation,
  prepareFederationRotation,
  publicFingerprint,
  readLocalConfig,
} = require("../lib/federation/identity");

const command = String(process.argv[2] || "status").toLowerCase();
const configPath = path.resolve(
  process.argv.find(arg => arg.startsWith("--config="))?.slice(9) ||
    ".config.json",
);
const confirmation =
  process.argv.find(arg => arg.startsWith("--confirm="))?.slice(10) || "";

function publicRecord(identity) {
  if (!identity) {
    return null;
  }
  return {
    keyId: identity.keyId,
    publicKeyJwk: identity.publicKeyJwk,
    fingerprint:
      identity.fingerprint ||
      (identity.publicKeyJwk ?
        publicFingerprint(identity.publicKeyJwk) :
        ""),
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === "prepare") {
    const pending = prepareFederationRotation(configPath);
    print({
      prepared: true,
      configPath,
      pending: publicRecord(pending),
      next:
        "Add this record to acceptedPublicKeys for this host on every peer, " +
        "verify the fingerprint out of band, then activate with " +
        `--confirm=${pending.fingerprint}`,
    });
  }
  else if (command === "activate") {
    const activated = activateFederationRotation(
      configPath,
      confirmation,
    );
    print({
      activated: true,
      configPath,
      current: publicRecord(activated),
      previousKeysRetained: activated.previousPublicKeys.length,
      next:
        "Promote the activated key to the primary peer key on every trusted " +
        "host, verify peer health, then remove stale acceptedPublicKeys.",
    });
  }
  else if (command === "cancel") {
    print({
      cancelled: cancelFederationRotation(configPath),
      configPath,
    });
  }
  else if (command === "status") {
    const local = readLocalConfig(configPath);
    const federation = local.federation || {};
    print({
      enabled: federation.enabled === true,
      configPath,
      current: publicRecord(federation),
      pending: publicRecord(federation.pendingIdentity),
      previousKeys: (federation.previousPublicKeys || []).map(publicRecord),
    });
  }
  else {
    throw new Error("Use status, prepare, activate, or cancel");
  }
}
catch (error) {
  process.stderr.write(`Federation key command failed: ${error.message}\n`);
  process.exitCode = 1;
}
