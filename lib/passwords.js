"use strict";

const argon2 = require("argon2");
const crypto = require("crypto");
const { promisify } = require("util");

const pbkdf2 = promisify(crypto.pbkdf2);

const CURRENT_VERSION = 3;
const VERSION_LENGTH = 2;

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  version: 0x13,
  saltLength: 16,
  hashLength: 32,
});

const V1_FULL_LENGTH = 98;
const V1_ITERATIONS_OFFSET = 2;
const V1_SALT_OFFSET = 6;
const V1_CHECK_OFFSET = 38;
const V1_MAC_OFFSET = 66;
const V1_MIN_ITERATIONS = 20000;
const V1_MAX_ITERATIONS = 10000000;

function decode(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid password hash");
  }
  return Buffer.from(value, "base64");
}

function same(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyV1(buffer, password) {
  if (buffer.length !== V1_FULL_LENGTH) {
    return false;
  }

  const iterations = buffer.readUInt32BE(V1_ITERATIONS_OFFSET);
  if (
    iterations < V1_MIN_ITERATIONS ||
    iterations > V1_MAX_ITERATIONS
  ) {
    return false;
  }

  const expectedCheck = buffer.subarray(V1_CHECK_OFFSET, V1_MAC_OFFSET);
  const actualCheck = crypto.
    createHash("sha224").
    update(buffer.subarray(0, V1_CHECK_OFFSET)).
    digest();
  if (!same(expectedCheck, actualCheck)) {
    return false;
  }

  const salt = buffer.subarray(V1_SALT_OFFSET, V1_CHECK_OFFSET);
  const key = await pbkdf2(password, salt, iterations, 64, "sha512");
  const actualMac = crypto.
    createHmac("sha256", key).
    update(buffer.subarray(0, V1_MAC_OFFSET)).
    digest();

  return same(buffer.subarray(V1_MAC_OFFSET), actualMac);
}

async function verifyArgon2(buffer, password) {
  const hash = buffer.subarray(VERSION_LENGTH).toString("utf8");
  if (!hash.startsWith("$argon2")) {
    return false;
  }
  return await argon2.verify(hash, password);
}

async function create(password, options = {}) {
  if (typeof password !== "string") {
    throw new Error("Password must be a string");
  }

  const hash = Buffer.from(await argon2.hash(password, ARGON2_OPTIONS));
  const wrapped = Buffer.alloc(VERSION_LENGTH + hash.length);
  wrapped.writeUInt16BE(CURRENT_VERSION, 0);
  hash.copy(wrapped, VERSION_LENGTH);
  return options.asBuffer ? wrapped : wrapped.toString("base64");
}

async function verify(value, password) {
  try {
    if (typeof password !== "string") {
      return false;
    }

    const buffer = decode(value);
    if (buffer.length < VERSION_LENGTH) {
      return false;
    }

    switch (buffer.readUInt16BE(0)) {
    case 0:
      return same(buffer.subarray(VERSION_LENGTH), Buffer.from(password));

    case 1:
      return await verifyV1(buffer, password);

    case 2:
      return await verifyArgon2(buffer, password);

    case CURRENT_VERSION:
      return await verifyArgon2(buffer, password);

    default:
      return false;
    }
  }
  catch {
    return false;
  }
}

function needsUpgrade(value) {
  try {
    const buffer = decode(value);
    return (
      buffer.length < VERSION_LENGTH ||
      buffer.readUInt16BE(0) !== CURRENT_VERSION
    );
  }
  catch {
    return true;
  }
}

module.exports = {
  ARGON2_OPTIONS,
  CURRENT_VERSION,
  create,
  needsUpgrade,
  verify,
};
