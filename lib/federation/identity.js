"use strict";

const crypto = require("crypto");
const fs = require("fs");

function readLocalConfig(configPath, fileSystem = fs) {
  if (!fileSystem.existsSync(configPath)) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(fileSystem.readFileSync(configPath, "utf8"));
  }
  catch (_) {
    throw new Error(
      `Cannot create federation identity: ${configPath} is not valid JSON`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Cannot create federation identity: ${configPath} must contain an object`,
    );
  }
  return parsed;
}

function writeLocalConfig(configPath, value, fileSystem = fs) {
  const temporaryPath = `${configPath}.federation-${process.pid}.tmp`;
  fileSystem.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
  fileSystem.renameSync(temporaryPath, configPath);
  try {
    fileSystem.chmodSync(configPath, 0o600);
  }
  catch (_) {
    // Windows-mounted filesystems may not expose POSIX permissions.
  }
}

function publicFingerprint(publicKeyJwk) {
  const stable = JSON.stringify({
    alg: publicKeyJwk.alg,
    e: publicKeyJwk.e,
    kty: publicKeyJwk.kty,
    n: publicKeyJwk.n,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function generateIdentity() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicExponent: 0x10001,
  });
  const privateKeyJwk = privateKey.export({ format: "jwk" });
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  privateKeyJwk.alg = "RS256";
  publicKeyJwk.alg = "RS256";
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem",
  });
  return {
    privateKeyJwk,
    publicKeyJwk,
    publicKeyPem: String(publicKeyPem),
    fingerprint: publicFingerprint(publicKeyJwk),
  };
}

function rotationKeyId(publicBaseUrl, fingerprint) {
  const origin = new URL(String(publicBaseUrl || "")).origin;
  const suffix = String(fingerprint || "").slice(0, 16);
  if (!suffix) {
    throw new Error("A federation key fingerprint is required");
  }
  return `${origin}/federation/actor#key-${suffix}`;
}

function prepareFederationRotation(configPath, fileSystem = fs) {
  const local = readLocalConfig(configPath, fileSystem);
  const federation =
    local.federation &&
    typeof local.federation === "object" &&
    !Array.isArray(local.federation) ?
      local.federation :
      null;
  if (!federation || federation.enabled !== true) {
    throw new Error("Federation must be enabled before preparing key rotation");
  }
  if (!federation.publicBaseUrl) {
    throw new Error("federation.publicBaseUrl is required for key rotation");
  }
  if (federation.pendingIdentity) {
    return federation.pendingIdentity;
  }
  const generated = generateIdentity();
  federation.pendingIdentity = Object.assign({}, generated, {
    keyId: rotationKeyId(
      federation.publicBaseUrl,
      generated.fingerprint,
    ),
    preparedAt: new Date().toISOString(),
  });
  local.federation = federation;
  writeLocalConfig(configPath, local, fileSystem);
  return federation.pendingIdentity;
}

function activateFederationRotation(
  configPath,
  expectedFingerprint,
  fileSystem = fs,
) {
  const local = readLocalConfig(configPath, fileSystem);
  const federation =
    local.federation &&
    typeof local.federation === "object" &&
    !Array.isArray(local.federation) ?
      local.federation :
      null;
  const pending = federation && federation.pendingIdentity;
  if (!pending) {
    throw new Error("No prepared federation key is waiting for activation");
  }
  if (
    !expectedFingerprint ||
    String(expectedFingerprint) !== pending.fingerprint
  ) {
    throw new Error(
      "Activation requires the complete pending federation fingerprint",
    );
  }
  const previous = Array.isArray(federation.previousPublicKeys) ?
    federation.previousPublicKeys.slice(0, 2) :
    [];
  if (federation.publicKeyJwk || federation.publicKeyPem) {
    previous.unshift({
      keyId:
        federation.keyId ||
        `${federation.publicBaseUrl}/federation/actor#main-key`,
      publicKeyJwk: federation.publicKeyJwk || null,
      publicKeyPem: federation.publicKeyPem || "",
      fingerprint:
        federation.fingerprint ||
        (federation.publicKeyJwk ?
          publicFingerprint(federation.publicKeyJwk) :
          ""),
      retiredAt: new Date().toISOString(),
    });
  }
  Object.assign(federation, {
    keyId: pending.keyId,
    privateKeyJwk: pending.privateKeyJwk,
    publicKeyJwk: pending.publicKeyJwk,
    publicKeyPem: pending.publicKeyPem,
    fingerprint: pending.fingerprint,
    previousPublicKeys: previous.slice(0, 3),
  });
  delete federation.pendingIdentity;
  local.federation = federation;
  writeLocalConfig(configPath, local, fileSystem);
  return federation;
}

function cancelFederationRotation(configPath, fileSystem = fs) {
  const local = readLocalConfig(configPath, fileSystem);
  if (!local.federation || !local.federation.pendingIdentity) {
    return false;
  }
  delete local.federation.pendingIdentity;
  writeLocalConfig(configPath, local, fileSystem);
  return true;
}

function identityComplete(federation) {
  return !!(
    federation &&
    federation.privateKeyJwk &&
    federation.privateKeyJwk.kty === "RSA" &&
    federation.privateKeyJwk.alg === "RS256" &&
    federation.publicKeyJwk &&
    federation.publicKeyJwk.kty === "RSA" &&
    federation.publicKeyJwk.alg === "RS256" &&
    federation.publicKeyPem
  );
}

function ensureFederationIdentity(config, options = {}) {
  const federation = config.get("federation");
  if (!federation || federation.enabled !== true) {
    return null;
  }
  if (identityComplete(federation)) {
    return federation;
  }
  const { configPath, fileSystem = fs } = options;
  if (!configPath) {
    throw new Error(
      "A local config path is required to create a federation identity",
    );
  }
  const generated = generateIdentity();
  const local = readLocalConfig(configPath, fileSystem);
  const localFederation =
    local.federation &&
    typeof local.federation === "object" &&
    !Array.isArray(local.federation) ?
      local.federation :
      {};
  local.federation = Object.assign({}, localFederation, generated);
  writeLocalConfig(configPath, local, fileSystem);
  const merged = Object.assign({}, federation, generated);
  config.set("federation", merged);
  console.log(
    `[security] Generated an RSA-3072 federation identity in ${configPath}`,
  );
  return merged;
}

module.exports = {
  readLocalConfig,
  writeLocalConfig,
  publicFingerprint,
  generateIdentity,
  rotationKeyId,
  prepareFederationRotation,
  activateFederationRotation,
  cancelFederationRotation,
  identityComplete,
  ensureFederationIdentity,
};
