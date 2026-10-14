"use strict";

const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");

const DEFAULTS = Object.freeze({
  policy: "balanced",
  fallbackThreshold: 75,
  softLimit: 75,
  hardLimit: 90,
  resumeLimit: 70,
  minFreeBytes: 1024 * 1024 * 1024,
});

function absolutePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("Storage volume path is required");
  }
  return path.resolve(process.cwd(), raw);
}

function percent(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

function normalizeVolume(raw, index, inherited) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`storage.volumes[${index}] must be an object`);
  }
  const id = String(raw.id || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(id)) {
    throw new Error(`Invalid storage volume id at index ${index}`);
  }
  const softLimit = percent(raw.softLimit, inherited.softLimit);
  const hardLimit = percent(raw.hardLimit, inherited.hardLimit);
  const resumeLimit = percent(raw.resumeLimit, inherited.resumeLimit);
  if (!(resumeLimit <= softLimit && softLimit < hardLimit)) {
    throw new Error(
      `Storage volume '${id}' must satisfy resumeLimit <= softLimit < hardLimit`,
    );
  }
  return Object.freeze({
    id,
    path: absolutePath(raw.path),
    role: raw.role === "fallback" ? "fallback" : "primary",
    enabled: raw.enabled !== false,
    readOnly: raw.readOnly === true,
    weight: Math.max(0.01, Number(raw.weight) || 1),
    softLimit,
    hardLimit,
    resumeLimit,
    minFreeBytes: Math.max(
      0,
      Number(raw.minFreeBytes ?? inherited.minFreeBytes) || 0,
    ),
  });
}

function pathsOverlap(a, b) {
  const rel = path.relative(a, b);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function loadConfig() {
  const raw = CONFIG.get("storage") || {};
  const inherited = {
    softLimit: percent(raw.softLimit, DEFAULTS.softLimit),
    hardLimit: percent(raw.hardLimit, DEFAULTS.hardLimit),
    resumeLimit: percent(raw.resumeLimit, DEFAULTS.resumeLimit),
    minFreeBytes: Math.max(
      0,
      Number(raw.minFreeBytes ?? DEFAULTS.minFreeBytes) || 0,
    ),
  };
  const configured = Array.isArray(raw.volumes) ? raw.volumes : [];
  const volumes = configured.length ?
    configured.map((volume, index) =>
      normalizeVolume(volume, index, inherited),
    ) :
    [
      Object.freeze({
        id: "uploads",
        path: absolutePath(CONFIG.get("uploads") || "uploads"),
        role: "primary",
        enabled: true,
        readOnly: false,
        weight: 1,
        ...inherited,
      }),
    ];

  const ids = new Set();
  for (const volume of volumes) {
    if (ids.has(volume.id)) {
      throw new Error(`Duplicate storage volume id '${volume.id}'`);
    }
    ids.add(volume.id);
  }
  for (let i = 0; i < volumes.length; i++) {
    for (let j = i + 1; j < volumes.length; j++) {
      if (pathsOverlap(volumes[i].path, volumes[j].path)) {
        throw new Error(
          `Storage volume paths overlap: '${volumes[i].id}' and '${volumes[j].id}'`,
        );
      }
    }
  }

  const policy = raw.policy === "primary-then-fallback" ?
    raw.policy :
    "balanced";
  return Object.freeze({
    policy,
    fallbackThreshold: percent(
      raw.fallbackThreshold,
      DEFAULTS.fallbackThreshold,
    ),
    volumes: Object.freeze(volumes),
  });
}

const STORAGE_CONFIG = loadConfig();
const VOLUMES_BY_ID = new Map(
  STORAGE_CONFIG.volumes.map(volume => [volume.id, volume]),
);
const LEGACY_VOLUME = Object.freeze({
  id: "legacy",
  path: absolutePath(CONFIG.get("uploads") || "uploads"),
  role: "primary",
  enabled: true,
  readOnly: true,
  weight: 1,
  softLimit: 100,
  hardLimit: 100,
  resumeLimit: 100,
  minFreeBytes: 0,
});

async function probeVolume(volume, reservedBytes = 0) {
  try {
    let probe = volume.path;
    for (;;) {
      try {
        await fs.promises.access(probe); break;
      }
      catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        break;
      }
      probe = parent;
    }
    const stats = await fs.promises.statfs(probe, { bigint: true });
    const total = Number(stats.blocks * stats.bsize);
    const free = Number(stats.bavail * stats.bsize);
    const used = Math.max(0, total - free);
    return {
      ok: true,
      total,
      free,
      used,
      usedPercent: total > 0 ? (used / total) * 100 : 100,
      reservedBytes: Math.max(0, Number(reservedBytes) || 0),
      effectiveFree: Math.max(
        0,
        free - Math.max(0, Number(reservedBytes) || 0),
      ),
      projectedUsedPercent: total > 0 ?
        ((used + Math.max(0, Number(reservedBytes) || 0)) / total) * 100 :
        100,
    };
  }
  catch (error) {
    return {
      ok: false,
      total: 0,
      free: 0,
      used: 0,
      usedPercent: 100,
      error: error.message || String(error),
    };
  }
}

const pendingProbes = new Map();

async function volumeStats(volume, reservedBytes = 0) {
  let pending = pendingProbes.get(volume.path);
  if (!pending) {
    pending = probeVolume(volume);
    pendingProbes.set(volume.path, pending);
    pending.finally(() => pendingProbes.delete(volume.path));
  }
  let timer;
  try {
    const stats = await Promise.race([pending, new Promise(resolve => {
      timer = setTimeout(() => resolve({ ok: false, error: "Storage probe timed out", free: 0, usedPercent: 100 }), 2000);
    })]);
    const reserved = Math.max(0, Number(reservedBytes) || 0);
    return { ...stats, reservedBytes: reserved, effectiveFree: Math.max(0, stats.free - reserved), projectedUsedPercent: stats.ok && stats.total ? (stats.used + reserved) / stats.total * 100 : 100 };
  }
  finally {
    clearTimeout(timer);
  }
}

async function storageSnapshot(reservations = {}) {
  const draining = await require("./broker").getMethod("hgetall")("storage:draining");
  return Promise.all(STORAGE_CONFIG.volumes.map(async volume => ({
    id: volume.id,
    path: volume.path,
    role: volume.role,
    enabled: volume.enabled,
    readOnly: volume.readOnly,
    draining: draining[volume.id] === "1",
    weight: volume.weight,
    softLimit: volume.softLimit,
    hardLimit: volume.hardLimit,
    resumeLimit: volume.resumeLimit,
    minFreeBytes: volume.minFreeBytes,
    ...await volumeStats(volume, reservations[volume.id]),
  })));
}

async function writableCandidates(requiredBytes = 0) {
  return (await storageSnapshot()).filter(volume =>
    volume.enabled &&
    !volume.readOnly && !volume.draining &&
    volume.ok &&
    volume.projectedUsedPercent < volume.hardLimit &&
    volume.effectiveFree - requiredBytes >= volume.minFreeBytes,
  );
}

function chooseLowestFill(candidates) {
  return candidates.slice().sort((a, b) => {
    const aScore =
      (a.projectedUsedPercent ?? a.usedPercent) / a.weight;
    const bScore =
      (b.projectedUsedPercent ?? b.usedPercent) / b.weight;
    return aScore - bScore || b.free - a.free || a.id.localeCompare(b.id);
  })[0];
}

function selectCandidate(config, candidates) {
  if (!candidates.length) {
    const error = new Error(
      "No writable storage volume has enough free space",
    );
    error.code = "STORAGE_CAPACITY_EXHAUSTED";
    throw error;
  }
  if (config.policy === "primary-then-fallback") {
    const primary = candidates.filter(
      volume =>
        volume.role === "primary" &&
        volume.usedPercent < config.fallbackThreshold,
    );
    return chooseLowestFill(
      primary.length ? primary : candidates.filter(v => v.role === "fallback"),
    ) || chooseLowestFill(candidates);
  }
  const primary = candidates.filter(
    volume =>
      volume.role === "primary" &&
      (volume.projectedUsedPercent ?? volume.usedPercent) <
        config.fallbackThreshold,
  );
  return chooseLowestFill(primary.length ? primary : candidates);
}

async function chooseVolume(requiredBytes = 0) {
  return selectCandidate(
    STORAGE_CONFIG,
    await writableCandidates(requiredBytes),
  );
}

function getVolume(id) {
  if (!id || id === "legacy") {
    return LEGACY_VOLUME;
  }
  const volume = VOLUMES_BY_ID.get(id);
  if (!volume) {
    throw new Error(`Unknown storage volume '${id}'`);
  }
  return volume;
}

async function placementPreview(requiredBytes = 0, reservations = {}) {
  const snapshot = await storageSnapshot(reservations);
  const candidates = snapshot.filter(volume =>
    volume.enabled &&
    !volume.readOnly &&
    volume.ok &&
    volume.projectedUsedPercent < volume.hardLimit &&
    volume.effectiveFree - requiredBytes >= volume.minFreeBytes,
  ).map(volume => Object.assign({}, volume, {
    projectedUsedPercent:
      ((volume.used + volume.reservedBytes + requiredBytes) / volume.total) *
        100,
  }));
  const chosen = selectCandidate(STORAGE_CONFIG, candidates);
  const volumes = snapshot.map(volume => {
    const output = Object.assign({}, volume);
    delete output.path;
    return output;
  });
  return {
    policy: STORAGE_CONFIG.policy,
    requiredBytes: Math.max(0, Number(requiredBytes) || 0),
    volumeId: chosen.id,
    volumes,
  };
}

module.exports = {
  STORAGE_CONFIG,
  getVolume,
  chooseVolume,
  storageSnapshot,
  placementPreview,
  selectCandidate,
};
