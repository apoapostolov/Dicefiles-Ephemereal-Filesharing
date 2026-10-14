"use strict";

const crypto = require("crypto");
const BROKER = require("../broker");

const redis = BROKER.getMethods("set");
let fedifyPromise;
const importedPrivateKeys = new Map();

function loadFedify() {
  if (!fedifyPromise) {
    fedifyPromise = import("@fedify/fedify");
  }
  return fedifyPromise;
}

function parseSignatureParameters(header) {
  const input = String(header || "");
  const read = name => {
    const match = input.match(new RegExp(`(?:^|;)${name}="([^"]+)"`, "i"));
    return match ? match[1] : "";
  };
  return {
    keyId: read("keyid"),
    nonce: read("nonce"),
    tag: read("tag"),
  };
}

function publicKeyPem(peer) {
  if (peer.publicKeyPem) {
    return peer.publicKeyPem;
  }
  return String(
    crypto.
      createPublicKey({ key: peer.publicKeyJwk, format: "jwk" }).
      export({ format: "pem", type: "spki" }),
  );
}

function pinnedKeyDocument(peer, acceptedKey = peer) {
  return {
    "@id": acceptedKey.keyId,
    "@type": ["https://w3id.org/security#Key"],
    "https://w3id.org/security#owner": [
      { "@id": `${peer.baseUrl}/federation/actor` },
    ],
    "https://w3id.org/security#publicKeyPem": [
      { "@value": publicKeyPem(acceptedKey) },
    ],
  };
}

function expressHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

function expressRequest(req, canonicalOrigin, body) {
  const url = new URL(req.originalUrl || req.url, canonicalOrigin);
  const options = {
    method: req.method,
    headers: expressHeaders(req),
  };
  if (body && !["GET", "HEAD"].includes(req.method)) {
    options.body = body;
  }
  return new Request(url, options);
}

async function getPrivateCryptoKey(identity) {
  const cacheKey = JSON.stringify(identity.privateKeyJwk);
  if (!importedPrivateKeys.has(cacheKey)) {
    const { importJwk } = await loadFedify();
    importedPrivateKeys.set(
      cacheKey,
      importJwk(identity.privateKeyJwk, "private"),
    );
  }
  return importedPrivateKeys.get(cacheKey);
}

async function signFederationRequest(request, identity) {
  const { signRequest } = await loadFedify();
  const privateKey = await getPrivateCryptoKey(identity);
  const keyId = new URL(
    identity.keyId ||
      `${identity.publicBaseUrl}/federation/actor#main-key`,
  );
  const nonce = crypto.randomBytes(24).toString("base64url");
  return signRequest(request, privateKey, keyId, {
    spec: "rfc9421",
    rfc9421: {
      nonce,
      tag: "dicefiles-federation",
      expires: true,
    },
  });
}

async function warmFederationCrypto(identity) {
  if (
    !identity ||
    identity.enabled !== true ||
    !identity.privateKeyJwk
  ) {
    return false;
  }
  await loadFedify();
  await getPrivateCryptoKey(identity);
  return true;
}

async function claimNonce(peerId, nonce, replayWindowSeconds) {
  const digest = crypto.
    createHash("sha256").
    update(`${peerId}\0${nonce}`).
    digest("hex");
  const result = await redis.set(
    `federation:nonce:${digest}`,
    "1",
    "NX",
    "EX",
    replayWindowSeconds,
  );
  return result === "OK";
}

async function verifyFederationRequest(req, config, body = null) {
  const signature = parseSignatureParameters(req.get("signature-input"));
  if (!signature.keyId || !signature.nonce) {
    return { ok: false, code: "FEDERATION_SIGNATURE_REQUIRED" };
  }
  if (signature.tag !== "dicefiles-federation") {
    return { ok: false, code: "FEDERATION_SIGNATURE_INVALID" };
  }
  let peer;
  let acceptedKey;
  for (const candidate of config.peers) {
    if (!candidate.enabled) {
      continue;
    }
    const matched = (candidate.acceptedKeys || [candidate]).find(
      key => key.keyId === signature.keyId,
    );
    if (matched) {
      peer = candidate;
      acceptedKey = matched;
      break;
    }
  }
  if (!peer || !acceptedKey) {
    return { ok: false, code: "FEDERATION_PEER_UNKNOWN" };
  }
  const loader = url => {
    const actorId = `${peer.baseUrl}/federation/actor`;
    const requested = String(url);
    if (![acceptedKey.keyId, actorId].includes(requested)) {
      throw new Error("Unpinned federation key");
    }
    return {
      contextUrl: null,
      documentUrl: requested,
      // Fedify 2.4 verifies that the key's owner also lists the key. Both
      // documents are synthesized from the same operator-approved pin; no
      // remote actor or key lookup is permitted.
      document: requested === acceptedKey.keyId ? pinnedKeyDocument(peer, acceptedKey) : {
        "@id": actorId,
        "@type": ["https://www.w3.org/ns/activitystreams#Person"],
        "https://w3id.org/security#publicKey": [pinnedKeyDocument(peer, acceptedKey)],
      },
    };
  };
  const { verifyRequestDetailed } = await loadFedify();
  const request = expressRequest(req, config.publicBaseUrl, body);
  const result = await verifyRequestDetailed(request, {
    spec: "rfc9421",
    documentLoader: loader,
    contextLoader: loader,
    timeWindow: { seconds: 60 },
  });
  if (!result.verified) {
    return {
      ok: false,
      code:
        result.reason && result.reason.type === "keyFetchError" ?
          "FEDERATION_KEY_INVALID" :
          "FEDERATION_SIGNATURE_INVALID",
    };
  }
  if (
    !(await claimNonce(
      peer.peerId,
      signature.nonce,
      config.limits.replayWindowSeconds,
    ))
  ) {
    return { ok: false, code: "FEDERATION_REPLAY" };
  }
  return { ok: true, peer };
}

module.exports = {
  parseSignatureParameters,
  publicKeyPem,
  pinnedKeyDocument,
  expressRequest,
  signFederationRequest,
  verifyFederationRequest,
  warmFederationCrypto,
  _loadFedify: loadFedify,
};
