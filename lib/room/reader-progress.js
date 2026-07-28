"use strict";

const PROGRESS_PREFIX = "dicefiles:readprogress:";
const MAX_PROGRESS_ENTRIES = 1000;
const MAX_PROGRESS_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function listProgressRecords(storage, liveKeys) {
  const records = [];
  if (!storage) {
    return records;
  }
  try {
    for (let i = 0; i < storage.length; i++) {
      const storageKey = storage.key(i);
      if (!storageKey || !storageKey.startsWith(PROGRESS_PREFIX)) {
        continue;
      }
      const fileKey = storageKey.slice(PROGRESS_PREFIX.length);
      if (liveKeys && !liveKeys.has(fileKey)) {
        continue;
      }
      const raw = storage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      records.push({ ...parsed, fileKey });
    }
  } catch (_) {
    return [];
  }
  return records.sort(
    (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0),
  );
}

/**
 * Remove only globally old/excess reader records. `liveKeys` is deliberately
 * absent: a current room snapshot cannot prove a file in another room is gone.
 */
function pruneProgressStorage(storage, options = {}) {
  if (!storage) {
    return [];
  }
  const now = Number(options.now) || Date.now();
  const maxEntries = Math.max(
    1,
    Number(options.maxEntries) || MAX_PROGRESS_ENTRIES,
  );
  const maxAgeMs = Math.max(
    1,
    Number(options.maxAgeMs) || MAX_PROGRESS_AGE_MS,
  );
  const records = [];
  const remove = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const storageKey = storage.key(i);
      if (!storageKey || !storageKey.startsWith(PROGRESS_PREFIX)) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(storage.getItem(storageKey));
      } catch (_) {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object") {
        remove.push(storageKey);
        continue;
      }
      const updatedAt = Number(parsed.updatedAt) || 0;
      if (updatedAt && now - updatedAt > maxAgeMs) {
        remove.push(storageKey);
        continue;
      }
      records.push({ storageKey, updatedAt });
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    remove.push(
      ...records
        .slice(maxEntries)
        .map((record) => record.storageKey),
    );
    for (const storageKey of new Set(remove)) {
      storage.removeItem(storageKey);
    }
    return Array.from(new Set(remove));
  } catch (_) {
    return [];
  }
}

module.exports = {
  MAX_PROGRESS_AGE_MS,
  MAX_PROGRESS_ENTRIES,
  PROGRESS_PREFIX,
  listProgressRecords,
  pruneProgressStorage,
};
