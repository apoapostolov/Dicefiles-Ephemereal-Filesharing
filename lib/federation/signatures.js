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

function pinnedKeyDocument(peer) {
  return {
    "@id": peer.keyId,
    "@type": ["https://w3id.org/security#Key"],
    "https://w3id.org/security#owner": [
      { "@id": `${peer.baseUrl}/federation/actor` },
    ],
    "https://w3id.org/security#publicKeyPem": [
      { "@value": publicKeyPem(peer) },
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
  const peer = config.peers.find(
    candidate =>
      candidate.enabled && candidate.keyId === signature.keyId,
  );
  if (!peer) {
    return { ok: false, code: "FEDERATION_PEER_UNKNOWN" };
  }
  const loader = url => {
    if (String(url) !== peer.keyId) {
      throw new Error("Unpinned federation key");
    }
    return {
      contextUrl: null,
      documentUrl: peer.keyId,
      document: pinnedKeyDocument(peer),
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
  _loadFedify: loadFedify,
};
