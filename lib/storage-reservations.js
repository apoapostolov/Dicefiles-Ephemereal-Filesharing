"use strict";

const CONFIG = require("./config");
const BROKER = require("./broker");
const {
  STORAGE_CONFIG,
  storageSnapshot,
  selectCandidate,
} = require("./storage-volumes");

const redis = BROKER.getMethods(
  "hgetall",
  "storagereserve",
  "storagerelease",
);
const RESERVATIONS_KEY = "storage:reservations";
const RESERVED_TOTALS_KEY = "storage:reserved";

function expiryKey(volumeId) {
  return `storage:reservation-expiry:${volumeId}`;
}

function expectedReservation(bytes) {
  const configured = Number(
    (CONFIG.get("storage") || {}).unknownUploadReservationBytes,
  );
  const fallback = 64 * 1024 * 1024;
  const value = Number(bytes);
  return Math.max(
    1,
    Math.floor(
      Number.isFinite(value) && value > 0 ?
        value :
        Number.isFinite(configured) && configured > 0 ?
          configured :
          fallback,
    ),
  );
}

function reservationTtlMs() {
  const configured = Number(
    (CONFIG.get("storage") || {}).reservationTtlMinutes,
  );
  const minutes =
    Number.isFinite(configured) && configured > 0 ? configured : 60;
  return Math.max(5, Math.min(24 * 60, minutes)) * 60000;
}

async function reserveUpload(uploadKey, bytes, preferredVolumeId) {
  const requested = expectedReservation(bytes);
  const attempted = new Set();
  for (let attempt = 0; attempt < STORAGE_CONFIG.volumes.length; attempt++) {
    const totals = await redis.hgetall(RESERVED_TOTALS_KEY);
    const candidates = storageSnapshot(totals).filter(volume =>
      !attempted.has(volume.id) &&
      (!preferredVolumeId || volume.id === preferredVolumeId) &&
      volume.enabled &&
      !volume.readOnly &&
      volume.ok &&
      volume.usedPercent < volume.hardLimit &&
      volume.free - requested >= volume.minFreeBytes
    ).map(volume => Object.assign({}, volume, {
      projectedUsedPercent:
        ((volume.used + volume.reservedBytes + requested) / volume.total) * 100,
    }));
    const selected = selectCandidate(STORAGE_CONFIG, candidates);
    attempted.add(selected.id);
    const capacityByPercent = Math.max(
      0,
      Math.floor(
        selected.total * (selected.hardLimit / 100) -
          selected.used,
      ),
    );
    const capacityByReserve = Math.max(
      0,
      selected.free - selected.minFreeBytes,
    );
    const maxReserved = Math.min(capacityByPercent, capacityByReserve);
    const now = Date.now();
    const result = await redis.storagereserve(
      RESERVATIONS_KEY,
      expiryKey(selected.id),
      RESERVED_TOTALS_KEY,
      uploadKey,
      selected.id,
      requested,
      maxReserved,
      now,
      now + reservationTtlMs(),
    );
    if (Number(result && result[0]) === 1) {
      return {
        volumeId: selected.id,
        bytes: requested,
        expiresAt: now + reservationTtlMs(),
      };
    }
  }
  const error = new Error(
    "No storage volume can safely reserve space for this upload",
  );
  error.code = "STORAGE_CAPACITY_EXHAUSTED";
  throw error;
}

async function releaseUpload(uploadKey, volumeId) {
  if (!uploadKey || !volumeId) {
    return 0;
  }
  try {
    return Number(
      await redis.storagerelease(
        RESERVATIONS_KEY,
        expiryKey(volumeId),
        RESERVED_TOTALS_KEY,
        uploadKey,
        volumeId,
      ),
    ) || 0;
  }
  catch (error) {
    console.warn(
      `Failed releasing storage reservation for ${uploadKey}:`,
      error.message || error,
    );
    return 0;
  }
}

async function reservationTotals() {
  const totals = await redis.hgetall(RESERVED_TOTALS_KEY);
  const output = {};
  for (const [id, bytes] of Object.entries(totals || {})) {
    output[id] = Math.max(0, Number(bytes) || 0);
  }
  return output;
}

module.exports = {
  expectedReservation,
  reserveUpload,
  releaseUpload,
  reservationTotals,
};
