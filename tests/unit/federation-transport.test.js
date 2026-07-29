"use strict";

const mockSignFederationRequest = jest.fn(async request => request);

jest.mock("../../lib/config", () => new Map([
  ["publicBaseUrl", "http://alpha.localhost"],
  ["federation", {
    enabled: true,
    peerId: "alpha",
    publicBaseUrl: "http://alpha.localhost",
    privateKeyJwk: { kty: "RSA" },
    peers: [{
      peerId: "beta",
      baseUrl: "http://beta.localhost",
      publicKeyJwk: { kty: "RSA" },
      allowedRooms: ["*"],
      allowPrivateNetwork: true,
    }],
    limits: { timeoutMs: 1000 },
  }],
]));

jest.mock("../../lib/federation/signatures", () => ({
  signFederationRequest: mockSignFederationRequest,
}));

const {
  responseFederationError,
  rulesCacheKey,
  signedFetch,
} = require("../../lib/federation/transport");

describe("federation transport contracts", () => {
  beforeEach(() => {
    mockSignFederationRequest.mockReset();
    mockSignFederationRequest.mockImplementation(async request => request);
  });

  afterEach(() => {
    delete global.fetch;
  });

  test("preserves remote authentication and protocol failure semantics", async () => {
    await expect(
      responseFederationError(
        new Response(JSON.stringify({
          error: { code: "FEDERATION_SIGNATURE_INVALID" },
        }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
        "beta",
        4096,
      ),
    ).resolves.toMatchObject({ code: "FEDERATION_KEY_INVALID", status: 401 });

    await expect(
      responseFederationError(
        new Response(JSON.stringify({
          error: { code: "FEDERATION_PROTOCOL_MISMATCH" },
        }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
        "beta",
        4096,
      ),
    ).resolves.toMatchObject({ code: "FEDERATION_PROTOCOL_MISMATCH" });
  });

  test("cache keys separate distinct source-side rule sets", () => {
    expect(rulesCacheKey(null)).toBe("all");
    expect(rulesCacheKey({ nameContains: "pf2" })).not.toBe(
      rulesCacheKey({ nameContains: "foundry" }),
    );
  });

  test("network timeout starts after local signing has completed", async () => {
    const slowSign = jest.fn(async request => {
      await new Promise(resolve => setTimeout(resolve, 1050));
      return request;
    });
    const fetchRequest = jest.fn(async (_request, options) => {
      expect(options.signal.aborted).toBe(false);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    let result;
    try {
      result = await signedFetch("beta", "/api/federation/v1/hello", {
        _signRequest: slowSign,
        _fetch: fetchRequest,
      });
    }
    catch (error) {
      throw error.cause || error;
    }
    expect(result).toMatchObject({ peer: { peerId: "beta" } });
    expect(slowSign).toHaveBeenCalledTimes(1);
  });
});
