"use strict";

const argon2 = require("argon2");
const crypto = require("crypto");
const { promisify } = require("util");
const passwords = require("../../lib/passwords");

const pbkdf2 = promisify(crypto.pbkdf2);

async function makeLegacyV1(password) {
  const buffer = Buffer.alloc(98);
  const iterations = 20000;
  buffer.writeUInt16BE(1, 0);
  buffer.writeUInt32BE(iterations, 2);
  Buffer.alloc(32, 7).copy(buffer, 6);
  crypto.
    createHash("sha224").
    update(buffer.subarray(0, 38)).
    digest().
    copy(buffer, 38);
  const key = await pbkdf2(
    password,
    buffer.subarray(6, 38),
    iterations,
    64,
    "sha512",
  );
  crypto.
    createHmac("sha256", key).
    update(buffer.subarray(0, 66)).
    digest().
    copy(buffer, 66);
  return buffer.toString("base64");
}

async function makeLegacyV2(password) {
  const hash = Buffer.from(await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 20 * 1024,
    timeCost: 5,
    parallelism: 1,
    version: 0x13,
    saltLength: 16,
    hashLength: 32,
  }));
  const buffer = Buffer.alloc(2 + hash.length);
  buffer.writeUInt16BE(2, 0);
  hash.copy(buffer, 2);
  return buffer.toString("base64");
}

describe("password hashes", () => {
  test("creates and verifies the current Argon2id format", async () => {
    const hash = await passwords.create("correct horse battery staple");
    expect(await passwords.verify(hash, "correct horse battery staple")).
      toBe(true);
    expect(await passwords.verify(hash, "wrong password")).toBe(false);
    expect(passwords.needsUpgrade(hash)).toBe(false);
  });

  test("verifies and upgrades legacy Argon2 hashes", async () => {
    const hash = await makeLegacyV2("legacy password");
    expect(await passwords.verify(hash, "legacy password")).toBe(true);
    expect(await passwords.verify(hash, "wrong password")).toBe(false);
    expect(passwords.needsUpgrade(hash)).toBe(true);
  });

  test("verifies and upgrades legacy PBKDF2 hashes", async () => {
    const hash = await makeLegacyV1("older password");
    expect(await passwords.verify(hash, "older password")).toBe(true);
    expect(await passwords.verify(hash, "wrong password")).toBe(false);
    expect(passwords.needsUpgrade(hash)).toBe(true);
  });

  test("verifies and upgrades legacy plaintext wrappers", async () => {
    const raw = Buffer.alloc(2 + Buffer.byteLength("old password"));
    raw.writeUInt16BE(0, 0);
    raw.write("old password", 2);
    const hash = raw.toString("base64");
    expect(await passwords.verify(hash, "old password")).toBe(true);
    expect(await passwords.verify(hash, "wrong password")).toBe(false);
    expect(passwords.needsUpgrade(hash)).toBe(true);
  });

  test("rejects malformed and unknown hashes without throwing", async () => {
    expect(await passwords.verify("not-base64!", "password")).toBe(false);
    expect(await passwords.verify(Buffer.from([0, 99]), "password")).toBe(false);
    expect(passwords.needsUpgrade("not-base64!")).toBe(true);
  });
});
