"use strict";

const setNonce = jest.fn().mockResolvedValue("OK");
jest.mock("../../lib/broker", () => ({
  getMethods: () => ({ set: setNonce }),
}));

const { generateIdentity } = require("../../lib/federation/identity");
const {
  parseSignatureParameters,
  signFederationRequest,
  verifyFederationRequest,
} = require("../../lib/federation/signatures");

function expressLike(signed) {
  const url = new URL(signed.url);
  const headers = Object.fromEntries(signed.headers.entries());
  return {
    method: signed.method,
    originalUrl: `${url.pathname}${url.search}`,
    url: `${url.pathname}${url.search}`,
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

describe("RFC 9421 federation signatures", () => {
  const alpha = Object.assign(
    {
      enabled: true,
      publicBaseUrl: "http://alpha.localhost",
      peerId: "alpha",
      limits: { replayWindowSeconds: 300 },
    },
    generateIdentity(),
  );

  test("signs with a pinned key id, nonce, and Dicefiles tag", async () => {
    const request = new Request(
      "http://beta.localhost/api/federation/v1/hello",
      { headers: { host: "beta.localhost" } },
    );
    const signed = await signFederationRequest(request, alpha);
    const params = parseSignatureParameters(
      signed.headers.get("signature-input"),
    );
    expect(signed.headers.get("signature")).toBeTruthy();
    expect(params.keyId).toBe(
      "http://alpha.localhost/federation/actor#main-key",
    );
    expect(params.nonce).toHaveLength(32);
    expect(params.tag).toBe("dicefiles-federation");
  });

  test("verifies only the configured peer key and claims its nonce", async () => {
    const request = new Request(
      "http://beta.localhost/api/federation/v1/hello",
      { headers: { host: "beta.localhost" } },
    );
    const signed = await signFederationRequest(request, alpha);
    const config = {
      publicBaseUrl: "http://beta.localhost",
      limits: { replayWindowSeconds: 300 },
      peers: [
        {
          enabled: true,
          peerId: "alpha",
          baseUrl: "http://alpha.localhost",
          keyId: "http://alpha.localhost/federation/actor#main-key",
          publicKeyJwk: alpha.publicKeyJwk,
          publicKeyPem: alpha.publicKeyPem,
        },
      ],
    };
    const result = await verifyFederationRequest(
      expressLike(signed),
      config,
    );
    expect(result).toMatchObject({
      ok: true,
      peer: { peerId: "alpha" },
    });
    expect(setNonce).toHaveBeenCalledWith(
      expect.stringMatching(/^federation:nonce:/),
      "1",
      "NX",
      "EX",
      300,
    );
  });

  test("rejects an unpinned key before any key URL fetch", async () => {
    const request = new Request(
      "http://beta.localhost/api/federation/v1/hello",
      { headers: { host: "beta.localhost" } },
    );
    const signed = await signFederationRequest(request, alpha);
    const result = await verifyFederationRequest(
      expressLike(signed),
      {
        publicBaseUrl: "http://beta.localhost",
        limits: { replayWindowSeconds: 300 },
        peers: [],
      },
    );
    expect(result).toEqual({
      ok: false,
      code: "FEDERATION_PEER_UNKNOWN",
    });
  });
});
