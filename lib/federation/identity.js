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
  identityComplete,
  ensureFederationIdentity,
};
