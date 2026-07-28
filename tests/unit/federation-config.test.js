"use strict";

const crypto = require("crypto");
const {
  normalizeFederationConfig,
  peerAllowsRoom,
  isLoopbackHost,
} = require("../../lib/federation/config");
const {
  generateIdentity,
  publicFingerprint,
} = require("../../lib/federation/identity");
const {
  normalizeFederatedRoomLinks,
  remoteFileToClient,
} = require("../../lib/federation/links");

function peerKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return Object.assign(publicKey.export({ format: "jwk" }), {
    alg: "RS256",
  });
}

describe("federation configuration", () => {
  test("is disabled and non-discoverable by default", () => {
    const value = normalizeFederationConfig({}, "");
    expect(value.enabled).toBe(false);
    expect(value.peers).toEqual([]);
  });

  test("requires a canonical public origin and stable peer id", () => {
    expect(() =>
      normalizeFederationConfig({ enabled: true, peerId: "alpha" }, ""),
    ).toThrow(/publicBaseUrl/);
    expect(() =>
      normalizeFederationConfig(
        {
          enabled: true,
          peerId: "bad peer",
          publicBaseUrl: "https://files.example",
        },
        "",
      ),
    ).toThrow(/peerId/);
  });

  test("pins peer origin, key, and inbound room allowlist", () => {
    const value = normalizeFederationConfig(
      {
        enabled: true,
        peerId: "alpha",
        publicBaseUrl: "https://alpha.example",
        peers: [
          {
            peerId: "beta",
            baseUrl: "https://beta.example",
            publicKeyJwk: peerKey(),
            allowedRooms: ["releases", "releases"],
          },
        ],
      },
      "",
    );
    expect(value.publicBaseUrl).toBe("https://alpha.example");
    expect(value.peers[0].keyId).toBe(
      "https://beta.example/federation/actor#main-key",
    );
    expect(value.peers[0].allowedRooms).toEqual(["releases"]);
    expect(peerAllowsRoom(value.peers[0], "releases")).toBe(true);
    expect(peerAllowsRoom(value.peers[0], "private-room")).toBe(false);
  });

  test("blocks insecure non-local peers unless explicitly allowed", () => {
    expect(() =>
      normalizeFederationConfig(
        {
          peers: [
            {
              peerId: "beta",
              baseUrl: "http://beta.example",
              publicKeyJwk: peerKey(),
            },
          ],
        },
        "",
      ),
    ).toThrow(/HTTPS/);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });
});

describe("federation identity", () => {
  test("generates an RSA-3072 identity with a stable public fingerprint", () => {
    const identity = generateIdentity();
    expect(identity.privateKeyJwk).toMatchObject({
      kty: "RSA",
      alg: "RS256",
    });
    expect(identity.publicKeyJwk).toMatchObject({
      kty: "RSA",
      alg: "RS256",
    });
    expect(identity.privateKeyJwk.d).toBeTruthy();
    expect(identity.publicKeyJwk.d).toBeUndefined();
    expect(identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(identity.fingerprint).toBe(
      publicFingerprint(identity.publicKeyJwk),
    );
  });
});

describe("federated room links", () => {
  test("normalizes and de-duplicates peer-room pairs", () => {
    const rows = normalizeFederatedRoomLinks([
      { peerId: "beta", roomId: "releases" },
      { peerId: "beta", roomId: "releases" },
      { peerId: "gamma", roomId: "releases", visibility: "members" },
      { peerId: "bad peer", roomId: "x" },
    ]);
    expect(rows).toEqual([
      { peerId: "beta", roomId: "releases" },
      {
        peerId: "gamma",
        roomId: "releases",
        visibility: "members",
      },
    ]);
  });

  test("maps remote metadata to a local proxy without exposing peer keys", () => {
    const file = remoteFileToClient(
      {
        key: "remote-key",
        name: "release.zip",
        size: 42,
        type: "archive",
        uploadedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2026-08-02T12:00:00.000Z",
        digest: null,
        roomName: "Releases",
      },
      {
        peerId: "beta",
        peerDisplayName: "Beta Files",
        roomId: "releases",
      },
      "destination",
    );
    expect(file.federated).toBe(true);
    expect(file.href).toContain(
      "/federation/files/destination/beta/releases/remote-key/release.zip",
    );
    expect(file.href).not.toContain("publicKey");
    expect(file.meta).toMatchObject({
      federationPeerId: "beta",
      federationRoomId: "releases",
      remoteKey: "remote-key",
    });
  });
});
