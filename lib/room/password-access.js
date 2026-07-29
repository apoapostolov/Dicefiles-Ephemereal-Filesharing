"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const CONFIG = require("../config");
const BROKER = require("../broker");

const PREPARE_DAYS_DEFAULT = 7;
const COOKIE_PREFIX = "dfa_";
const lockRedis = BROKER.getMethods("get", "set", "del");

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRotationLock(roomid, fn) {
  const key = `lock:room-password:${roomid}`;
  const owner = crypto.randomBytes(16).toString("base64url");
  for (let attempt = 0; attempt < 20; attempt++) {
    const acquired = await lockRedis.set(key, owner, "NX", "PX", 15000);
    if (acquired === "OK") {
      try {
        return await fn();
      }
      finally {
        if ((await lockRedis.get(key)) === owner) {
          await lockRedis.del(key);
        }
      }
    }
    await pause(100);
  }
  throw new Error("Room password rotation is busy; try again");
}

function safePolicy(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const rotation = value.rotation === "fixed-days" ? "fixed-days" : "monthly";
  const prepareValue = Number(value.prepareDays);
  return {
    enabled: value.enabled === true,
    rotation,
    days: rotation === "fixed-days" ?
      Math.max(1, Math.min(365, Math.floor(Number(value.days) || 30))) :
      0,
    prepareDays: Math.max(0, Math.min(31, Math.floor(
      Number.isFinite(prepareValue) ? prepareValue : PREPARE_DAYS_DEFAULT,
    ))),
  };
}

function periodFor(policy, now = Date.now()) {
  const date = new Date(now);
  if (policy.rotation === "fixed-days") {
    const duration = policy.days * 86400000;
    const start = Math.floor(now / duration) * duration;
    return {
      id: `d${Math.floor(start / duration)}`,
      startsAt: start,
      endsAt: start + duration,
    };
  }
  const startsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const endsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return {
    id: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    startsAt,
    endsAt,
  };
}

function nextPeriod(policy, current) {
  return periodFor(policy, current.endsAt + 1000);
}

function generatePassword() {
  return Array.from({ length: 4 }, () =>
    crypto.randomBytes(3).toString("base64url").toLowerCase(),
  ).join("-");
}

function encryptionKey(roomid) {
  return crypto.
    createHash("sha256").
    update(`${CONFIG.get("secret")}:room-password:${roomid}`).
    digest();
}

function encrypt(roomid, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(roomid), iv);
  const data = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

function decrypt(roomid, encrypted) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(roomid),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function createSecret(roomid, password, period, revision) {
  const clear = password || generatePassword();
  return {
    periodId: period.id,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    revision,
    verifier: await argon2.hash(clear, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
    encrypted: encrypt(roomid, clear),
  };
}

function ensureCurrent(room) {
  const policy = safePolicy(room.config.get("passwordAccess"));
  if (!policy.enabled) {
    return { policy, current: null, next: null };
  }
  const now = Date.now();
  const expected = periodFor(policy, now);
  const stored = room.pconfig.get("passwordAccessSecret") || {};
  const current = stored.current || null;
  const next = stored.next || null;
  const prepareAt = expected.endsAt - policy.prepareDays * 86400000;
  const needsCurrent =
    !current || current.periodId !== expected.id || current.endsAt <= now;
  const upcoming = nextPeriod(policy, expected);
  const needsNext =
    policy.prepareDays > 0 &&
    now >= prepareAt &&
    (!next || next.periodId !== upcoming.id);
  if (needsCurrent || needsNext) {
    return withRotationLock(room.roomid, () => {
      const refreshed = room.pconfig.get("passwordAccessSecret") || {};
      const refreshedCurrent = refreshed.current || null;
      const refreshedNext = refreshed.next || null;
      if (
        refreshedCurrent &&
        refreshedCurrent.periodId === expected.id &&
        refreshedCurrent.endsAt > now &&
        (!needsNext ||
          (refreshedNext && refreshedNext.periodId === upcoming.id))
      ) {
        return {
          policy,
          current: refreshedCurrent,
          next: refreshedNext,
        };
      }
      return rotatePreparedState(
        room,
        policy,
        expected,
        now,
        refreshed,
      );
    });
  }
  return { policy, current, next };
}

async function rotatePreparedState(room, policy, expected, now, stored) {
  let current = stored.current || null;
  let next = stored.next || null;
  let changed = false;
  let currentChanged = false;
  const revision = Math.max(
    1,
    Number((current && current.revision) || stored.revision) || 1,
  );

  if (!current || current.periodId !== expected.id || current.endsAt <= now) {
    if (next && next.periodId === expected.id) {
      current = next;
    }
    else {
      current = await createSecret(room.roomid, null, expected, revision + 1);
    }
    next = null;
    changed = true;
    currentChanged = true;
  }

  const upcoming = nextPeriod(policy, expected);
  const prepareAt = expected.endsAt - policy.prepareDays * 86400000;
  if (
    policy.prepareDays > 0 &&
    now >= prepareAt &&
    (!next || next.periodId !== upcoming.id)
  ) {
    next = await createSecret(
      room.roomid,
      null,
      upcoming,
      current.revision + 1,
    );
    changed = true;
  }
  if (changed) {
    stored = { current, next, revision: current.revision };
    room.pconfig.set("passwordAccessSecret", stored);
    if (currentChanged) {
      room.config.set("passwordAccessEpoch", Date.now());
    }
  }
  return { policy, current, next };
}

async function configure(room, input = {}) {
  const previous = safePolicy(room.config.get("passwordAccess"));
  const policy = safePolicy({
    enabled: input.enabled === undefined ? previous.enabled : input.enabled,
    rotation: input.rotation || previous.rotation,
    days: input.days || previous.days,
    prepareDays:
      input.prepareDays === 0 ? 0 : input.prepareDays || previous.prepareDays,
  });
  if (!policy.enabled) {
    room.pconfig.delete("passwordAccessSecret");
    room.config.set("passwordAccess", policy);
    room.config.set("passwordAccessEpoch", Date.now());
    return { ...policy, currentPassword: "", nextPassword: "" };
  }

  const period = periodFor(policy);
  const old = room.pconfig.get("passwordAccessSecret") || {};
  const revision =
    Math.max(0, Number(old.current && old.current.revision) || 0) + 1;
  const current = await createSecret(
    room.roomid,
    String(input.password || "").trim() || null,
    period,
    revision,
  );
  room.pconfig.set("passwordAccessSecret", {
    current,
    next: null,
    revision,
  });
  room.config.set("passwordAccess", policy);
  room.config.set("passwordAccessEpoch", Date.now());
  return adminState(room, true);
}

async function rotateNow(room, password) {
  const policy = safePolicy(room.config.get("passwordAccess"));
  if (!policy.enabled) {
    throw new Error("Password access is not enabled");
  }
  const old = room.pconfig.get("passwordAccessSecret") || {};
  const period = periodFor(policy);
  const revision =
    Math.max(0, Number(old.current && old.current.revision) || 0) + 1;
  const current = await createSecret(
    room.roomid,
    String(password || "").trim() || null,
    period,
    revision,
  );
  room.pconfig.set("passwordAccessSecret", {
    current,
    next: null,
    revision,
  });
  room.config.set("passwordAccessEpoch", Date.now());
  return adminState(room, true);
}

async function adminState(room, reveal = false) {
  const { policy, current, next } = await ensureCurrent(room);
  return {
    ...policy,
    periodId: current ? current.periodId : "",
    startsAt: current ? current.startsAt : 0,
    endsAt: current ? current.endsAt : 0,
    hasPreparedNext: !!next,
    nextStartsAt: next ? next.startsAt : 0,
    currentPassword:
      reveal && current ? decrypt(room.roomid, current.encrypted) : "",
    nextPassword: reveal && next ? decrypt(room.roomid, next.encrypted) : "",
  };
}

function cookieName(roomid) {
  return `${COOKIE_PREFIX}${String(roomid).replace(/[^a-z0-9_-]/gi, "")}`;
}

function signGrant(roomid, token, current) {
  const payload = Buffer.from(
    JSON.stringify({
      r: roomid,
      p: current.periodId,
      v: current.revision,
      e: current.endsAt,
      b: crypto.
        createHash("sha256").
        update(String(token || "")).
        digest("base64url"),
    }),
  ).toString("base64url");
  const signature = crypto.
    createHmac("sha256", CONFIG.get("secret")).
    update(payload).
    digest("base64url");
  return `${payload}.${signature}`;
}

function validGrant(roomid, token, current, value) {
  if (!value || !current) {
    return false;
  }
  const [payload, signature] = String(value).split(".");
  if (!payload || !signature) {
    return false;
  }
  const expected = crypto.
    createHmac("sha256", CONFIG.get("secret")).
    update(payload).
    digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    const binding = crypto.
      createHash("sha256").
      update(String(token || "")).
      digest("base64url");
    return (
      parsed.r === roomid &&
      parsed.p === current.periodId &&
      parsed.v === current.revision &&
      parsed.e === current.endsAt &&
      parsed.e > Date.now() &&
      parsed.b === binding
    );
  }
  catch (_) {
    return false;
  }
}

async function allowed(room, user, token, cookies = {}) {
  const { policy, current } = await ensureCurrent(room);
  if (!policy.enabled) {
    return true;
  }
  if (
    (user && user.role === "mod") ||
    room.owns(user && user.account, token)
  ) {
    return true;
  }
  return validGrant(room.roomid, token, current, cookies[cookieName(room.roomid)]);
}

async function authenticate(room, password, token) {
  const { policy, current } = await ensureCurrent(room);
  if (!policy.enabled || !current) {
    return null;
  }
  const ok = await argon2.verify(current.verifier, String(password || ""));
  if (!ok) {
    return null;
  }
  return {
    name: cookieName(room.roomid),
    value: signGrant(room.roomid, token, current),
    expires: new Date(current.endsAt),
  };
}

module.exports = {
  safePolicy,
  periodFor,
  ensureCurrent,
  configure,
  rotateNow,
  adminState,
  allowed,
  authenticate,
  cookieName,
};
