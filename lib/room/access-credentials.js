"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const CONFIG = require("../config");
const { withLease } = require("../redis-lease");
const { withVerificationSlot } = require("../password-verifier");

const read = (map, key) => map.getFresh ? map.getFresh(key) : map.get(key);
const write = (map, key, value) => map.setDurable ? map.setDurable(key, value) : map.set(key, value);
const access = () => require("./password-access");
const lock = (room, action) => room.config.getFresh ? withLease(`lock:room-password:${room.roomid}`, action) : action();
const binding = value => crypto.createHash("sha256").update(String(value || "")).digest("base64url");
const selector = (room, password) => crypto.createHmac("sha256", CONFIG.get("secret")).update(`credential:${room.roomid}:${password}`).digest("base64url");
const failure = message => Object.assign(new Error(message), { status: 400 });

function period(record, now = Date.now()) {
  if (record.rotation === "manual") {
    return { id: `manual-${record.id}`, startsAt: record.createdAt, endsAt: record.expiresAt };
  }
  const result = access().periodFor(access().safePolicy(record), now);
  return { ...result, endsAt: Math.min(result.endsAt, record.expiresAt) };
}

function publicRecord(record) {
  return { id: record.id, key: record.id, uploaded: record.createdAt, label: record.label, mode: record.mode, state: record.state, rotation: record.rotation, days: record.days, startsAt: record.current.startsAt, endsAt: record.current.endsAt, expiresAt: record.expiresAt, binding: record.binding, accountId: record.accountId || "", maxActivations: record.maxActivations, activations: record.activations.length, revision: record.current.revision };
}

async function audit(room, type, record) {
  const entries = await read(room.pconfig, "accessCredentialAudit") || [];
  entries.push({ key: crypto.randomUUID(), uploaded: Date.now(), at: new Date().toISOString(), type, credentialId: record.id, label: record.label });
  await write(room.pconfig, "accessCredentialAudit", entries.slice(-200));
}

async function changed(room) {
  await write(room.config, "passwordAccessEpoch", crypto.randomUUID());
}

async function list(room) {
  return (await read(room.pconfig, "accessCredentials") || []).map(publicRecord);
}

async function create(room, input = {}) {
  return lock(room, async () => {
    if (!(await read(room.config, "passwordAccess"))?.enabled) {
      throw failure("Enable room password protection first");
    }
    const records = await read(room.pconfig, "accessCredentials") || [];
    if (records.length >= 50) {
      throw failure("A room supports at most 50 credentials");
    }
    if (!["cohort", "personal"].includes(input.mode)) {
      throw failure("Credential mode must be cohort or personal");
    }
    const now = Date.now();
    const expiresAt = input.expiresAt == null ? now + 365 * 86400000 : Number(input.expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 366 * 86400000) {
      throw failure("Credential expiry must be within the next year");
    }
    const maxActivations = input.maxActivations == null ? (input.mode === "personal" ? 1 : 0) : Number(input.maxActivations);
    if (!Number.isSafeInteger(maxActivations) || maxActivations < 0 || maxActivations > 1000) {
      throw failure("Activation limit must be between 0 and 1000");
    }
    const label = String(input.label || "").trim();
    if (!label || label.length > 80) {
      throw failure("Credential label is required and must be under 80 characters");
    }
    if (input.password && (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 256)) {
      throw failure("Custom credential passwords must have 12–256 characters");
    }
    const rotation = input.rotation || "monthly";
    if (!["monthly", "fixed-days", "manual"].includes(rotation)) {
      throw failure("Unsupported credential rotation");
    }
    const record = { id: crypto.randomUUID(), label, mode: input.mode, state: "active", rotation, days: Math.max(1, Math.min(365, Number(input.days) || 30)), createdAt: now, expiresAt, binding: input.mode === "personal" ? (input.binding === "browser" ? "browser" : "account") : "none", accountId: String(input.accountId || "").slice(0, 128), boundBrowser: "", maxActivations, activations: [] };
    const clear = input.password || access().credentialCrypto.generatePassword();
    if (records.some(value => value.selector === selector(room, clear))) {
      throw failure("Credential passwords must be unique in this room");
    }
    record.current = await access().credentialCrypto.createSecret(room.roomid, clear, period(record), 1);
    record.selector = selector(room, clear);
    records.push(record);
    await write(room.pconfig, "accessCredentials", records);
    await audit(room, "created", record); await changed(room);
    return publicRecord(record);
  });
}

async function mutate(room, id, input = {}) {
  return lock(room, async () => {
    const records = await read(room.pconfig, "accessCredentials") || [];
    const record = records.find(item => item.id === id);
    if (!record) {
      throw Object.assign(new Error("Credential not found"), { status: 404 });
    }
    if (input.label !== undefined) {
      if (typeof input.label !== "string" || !input.label.trim() || input.label.length > 80) {
        throw failure("Invalid credential label");
      }
      record.label = input.label.trim();
    }
    if (input.state !== undefined) {
      if (!["active", "suspended", "revoked"].includes(input.state)) {
        throw failure("Invalid credential state");
      }
      record.state = input.state; record.current.revision++;
    }
    if (input.maxActivations !== undefined) {
      if (!Number.isInteger(input.maxActivations) || input.maxActivations < 0 || input.maxActivations > 1000) {
        throw failure("Invalid activation limit");
      }
      record.maxActivations = input.maxActivations;
    }
    if (input.rotate === true) {
      if (input.password && (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 256)) {
        throw failure("Custom credential passwords must have 12–256 characters");
      }
      const clear = input.password || access().credentialCrypto.generatePassword();
      if (records.some(other => other.id !== record.id && other.selector === selector(room, clear))) {
        throw failure("Credential passwords must be unique in this room");
      }
      record.current = await access().credentialCrypto.createSecret(room.roomid, clear, period(record), record.current.revision + 1);
      record.selector = selector(room, clear);
    }
    await write(room.pconfig, "accessCredentials", records);
    await audit(room, input.rotate ? "rotated" : "updated", record); await changed(room);
    return publicRecord(record);
  });
}

async function ensureRecord(room, id) {
  const records = await read(room.pconfig, "accessCredentials") || [];
  const record = records.find(item => item.id === id);
  if (!record || record.state !== "active" || record.expiresAt <= Date.now()) {
    return null;
  }
  const expected = period(record);
  if (record.current.periodId === expected.id && record.current.endsAt > Date.now()) {
    return record;
  }
  if (record.rotation === "manual") {
    return null;
  }
  return lock(room, async () => {
    const latest = await read(room.pconfig, "accessCredentials") || [];
    const value = latest.find(item => item.id === id);
    if (!value || value.state !== "active" || value.expiresAt <= Date.now()) {
      return null;
    }
    const nextPeriod = period(value);
    if (value.current.periodId !== nextPeriod.id) {
      const clear = access().credentialCrypto.generatePassword();
      value.current = await access().credentialCrypto.createSecret(room.roomid, clear, nextPeriod, value.current.revision + 1);
      value.selector = selector(room, clear);
      await write(room.pconfig, "accessCredentials", latest);
      await audit(room, "period-rotated", value); await changed(room);
    }
    return value;
  });
}

function principalAllowed(record, user, token) {
  if (record.mode !== "personal") {
    return true;
  }
  if (record.binding === "account") {
    return !!user?.account && record.accountId === user.account;
  }
  return !!token && record.boundBrowser === binding(token);
}

async function grantState(room, value, user, token) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(value || "").split(".")[0], "base64url").toString());
  }
  catch (_) {
    return null;
  }
  if (typeof parsed.c !== "string" || !/^[a-f0-9-]{36}$/.test(parsed.c)) {
    return null;
  }
  const record = await ensureRecord(room, parsed.c);
  const deviceIndex = record ? record.activations.indexOf(binding(token)) : -1;
  const activated = record && (!record.maxActivations || deviceIndex >= 0 && deviceIndex < record.maxActivations);
  return activated && principalAllowed(record, user, token) ? { ...record.current, credentialId: record.id } : null;
}

async function authenticate(room, password, token, user) {
  const records = await read(room.pconfig, "accessCredentials") || [];
  const lookup = selector(room, password);
  const match = records.find(record => record.selector === lookup);
  if (!match) {
    return undefined;
  } // Shared credential verifier remains the fallback.
  return lock(room, async () => {
    const latest = await read(room.pconfig, "accessCredentials") || [];
    const record = latest.find(item => item.id === match.id);
    if (!record || !await withVerificationSlot(() => argon2.verify(record.current.verifier, password)) || record.state !== "active" || record.expiresAt <= Date.now() || record.current.endsAt <= Date.now()) {
      return null;
    }
    const device = binding(token);
    if (record.mode === "personal") {
      if (record.binding === "account") {
        if (!user?.account || record.accountId && record.accountId !== user.account) {
          return null;
        }
        record.accountId ||= user.account;
      }
      else {
        if (!token || record.boundBrowser && record.boundBrowser !== device) {
          return null;
        }
        record.boundBrowser ||= device;
      }
    }
    if (!record.activations.includes(device)) {
      if (record.maxActivations && record.activations.length >= record.maxActivations) {
        return null;
      }
      if (record.activations.length < 1000) {
        record.activations.push(device);
      }
      await write(room.pconfig, "accessCredentials", latest);
      await audit(room, "activated", record);
    }
    return { ...record.current, credentialId: record.id };
  });
}

async function remove(room, id) {
  return lock(room, async () => {
    const records = await read(room.pconfig, "accessCredentials") || [];
    const record = records.find(item => item.id === id);
    if (!record) {
      throw Object.assign(new Error("Credential not found"), { status: 404 });
    }
    await write(room.pconfig, "accessCredentials", records.filter(item => item.id !== id));
    await audit(room, "revoked", record); await changed(room);
    return { id, state: "revoked" };
  });
}

async function reveal(room, id) {
  const record = await ensureRecord(room, id);
  if (!record) {
    throw Object.assign(new Error("Credential is unavailable"), { status: 404 });
  }
  await lock(room, () => audit(room, "revealed", record));
  return { id: record.id, password: access().credentialCrypto.decrypt(room.roomid, record.current.encrypted), endsAt: record.current.endsAt };
}

module.exports = { list, create, mutate, remove, grantState, authenticate, reveal, readAudit: room => read(room.pconfig, "accessCredentialAudit") };
