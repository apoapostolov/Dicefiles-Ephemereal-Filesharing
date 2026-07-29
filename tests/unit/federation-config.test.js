"use strict";

const crypto = require("crypto");
const {
  normalizeFederationConfig,
  peerAllowsRoom,
  isLoopbackHost,
} = require("../../lib/federation/config");
const {
  activateFederationRotation,
  generateIdentity,
  prepareFederationRotation,
  publicFingerprint,
} = require("../../lib/federation/identity");
const {
  federationRuleFile,
  normalizeFederatedRoomLinks,
  requestedFederationRules,
  remoteFileToClient,
} = require("../../lib/federation/links");
const {
  fileMatchesLinkRules,
} = require("../../lib/room/room-links");

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
    const stagedKey = peerKey();
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
            acceptedPublicKeys: [{
              keyId: "https://beta.example/federation/actor#key-next",
              publicKeyJwk: stagedKey,
            }],
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
    expect(value.peers[0].acceptedKeys).toHaveLength(2);
    expect(value.peers[0].acceptedKeys[1]).toMatchObject({
      keyId: "https://beta.example/federation/actor#key-next",
      publicKeyJwk: stagedKey,
    });
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

  test("prepares and activates a confirmed two-phase key rotation", () => {
    const configPath = "/private/.config.json";
    const current = generateIdentity();
    const files = new Map([
      [configPath, JSON.stringify({
        federation: Object.assign({
          enabled: true,
          publicBaseUrl: "https://alpha.example",
        }, current),
      })],
    ]);
    const fileSystem = {
      existsSync: path => files.has(path),
      readFileSync: path => files.get(path),
      writeFileSync: (path, value) => files.set(path, String(value)),
      renameSync: (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      chmodSync: () => {},
    };
    const pending = prepareFederationRotation(configPath, fileSystem);
    expect(pending.keyId).toMatch(
      /^https:\/\/alpha\.example\/federation\/actor#key-/,
    );
    expect(pending.fingerprint).not.toBe(current.fingerprint);
    expect(() =>
      activateFederationRotation(configPath, "wrong", fileSystem),
    ).toThrow(/complete pending federation fingerprint/);

    const activated = activateFederationRotation(
      configPath,
      pending.fingerprint,
      fileSystem,
    );
    expect(activated.fingerprint).toBe(pending.fingerprint);
    expect(activated.previousPublicKeys[0].fingerprint).toBe(
      current.fingerprint,
    );
    expect(activated.pendingIdentity).toBeUndefined();
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

  test("validates source-side rules without exposing tags or uploader data", () => {
    const validation = requestedFederationRules(
      JSON.stringify({
        tagContains: "pf2e AND remaster",
        userContains: "alice OR release-bot",
      }),
    );
    expect(validation.valid).toBe(true);
    const internal = federationRuleFile({
      name: "Player Core.pdf",
      type: "document",
      tags: { system: "pf2e", edition: "remaster", usernick: "Alice" },
      meta: { account: "alice" },
      uploaded: Date.now(),
    });
    expect(fileMatchesLinkRules(internal, validation.rules)).toBe(true);

    const safe = remoteFileToClient(
      {
        key: "remote-key",
        name: "Player Core.pdf",
        size: 42,
        type: "document",
        uploadedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2026-08-02T12:00:00.000Z",
        roomName: "Releases",
      },
      { peerId: "beta", roomId: "releases" },
      "destination",
    );
    expect(JSON.stringify(safe)).not.toMatch(/alice|pf2e|remaster/i);
  });

  test("rejects malformed or unsafe remote rule expressions", () => {
    expect(requestedFederationRules("{").valid).toBe(false);
    const invalid = requestedFederationRules(
      JSON.stringify({ tagContains: "/[/" }),
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toHaveProperty("tagContains");
  });
});
