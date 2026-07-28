"use strict";

/**
 * Pure continuity/discovery helpers shared by the room client and tests.
 */

function finiteTimestamp(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isRequestFile(file) {
  return !!(file && file.meta && file.meta.request);
}

function isLinkedFile(file) {
  return !!(
    file &&
    (file.linked ||
      file.linkedFrom ||
      (file.meta && file.meta.linkedFrom))
  );
}

function isBotFile(file) {
  const meta = (file && file.meta) || {};
  return meta.role === "bot" || meta.bot === true || meta.bot === "true";
}

function normalizeIdentity(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function linkedSourceId(file) {
  if (!file) {
    return "";
  }
  const meta = file.meta || {};
  return normalizeIdentity(
    meta.linkedFrom ||
      file.linkedFrom ||
      (typeof file.linked === "string" ? file.linked : ""),
  );
}

function isOwnUpload(file, viewer) {
  if (!file || !viewer) {
    return false;
  }
  const meta = file.meta || {};
  const tags = file.tags || {};
  const fileAccount = normalizeIdentity(meta.account);
  const viewerAccount = normalizeIdentity(viewer.account);
  if (fileAccount && viewerAccount && fileAccount === viewerAccount) {
    return true;
  }
  const uploader = normalizeIdentity(
    tags.usernick || tags.user || meta.usernick || meta.user,
  );
  const viewerNick = normalizeIdentity(viewer.nick);
  return !!(uploader && viewerNick && uploader === viewerNick);
}

function didCompleteCatchUpDownload(result) {
  return !!(
    result &&
    result.cancelled !== true &&
    Number(result.failed) === 0
  );
}

/**
 * Normalize the room visit record. A null linked-key baseline is intentional:
 * older records should not make every historical mirror look newly linked.
 */
function normalizeVisitState(value, fallbackTimestamp) {
  const source = value && typeof value === "object" ? value : {};
  const linkedKeys = Array.isArray(source.knownLinkedKeys)
    ? Array.from(
        new Set(
          source.knownLinkedKeys.filter(
            (key) => typeof key === "string" && key,
          ),
        ),
      )
    : null;
  const linkedRooms = Array.isArray(source.knownLinkedRooms)
    ? Array.from(
        new Set(
          source.knownLinkedRooms
            .map(normalizeIdentity)
            .filter(Boolean),
        ),
      )
    : null;
  return {
    lastSeenServerTime: finiteTimestamp(
      source.lastSeenServerTime,
      finiteTimestamp(fallbackTimestamp),
    ),
    knownLinkedKeys: linkedKeys,
    knownLinkedRooms: linkedRooms,
  };
}

function requestStatus(file) {
  return file && (file.status || (file.meta && file.meta.status)) === "fulfilled"
    ? "fulfilled"
    : "open";
}

function wasUploadedSince(file, since) {
  return finiteTimestamp(file && file.uploaded) > since;
}

function wasFulfilledSince(file, since) {
  return (
    isRequestFile(file) &&
    requestStatus(file) === "fulfilled" &&
    finiteTimestamp(
      file.fulfilledAt || (file.meta && file.meta.fulfilledAt),
    ) > since
  );
}

function isLinkedDelta(file, state) {
  if (!isLinkedFile(file)) {
    return false;
  }
  if (wasUploadedSince(file, state.lastSeenServerTime)) {
    return true;
  }
  const sourceId = linkedSourceId(file);
  if (
    sourceId &&
    Array.isArray(state.knownLinkedRooms) &&
    !state.knownLinkedRooms.includes(sourceId)
  ) {
    return true;
  }
  return (
    Array.isArray(state.knownLinkedKeys) &&
    !state.knownLinkedKeys.includes(file.key)
  );
}

/**
 * Classify each item once, in user-facing priority order.
 */
function buildActivityDigest(files, rawState, viewer) {
  const state = normalizeVisitState(rawState, Date.now());
  const digest = {
    fulfilledRequests: [],
    requests: [],
    linked: [],
    bots: [],
    uploads: [],
    total: 0,
    keys: [],
  };

  for (const file of files || []) {
    if (!file || file.expired) {
      continue;
    }
    if (!isRequestFile(file) && isOwnUpload(file, viewer)) {
      continue;
    }
    let bucket = null;
    if (wasFulfilledSince(file, state.lastSeenServerTime)) {
      bucket = digest.fulfilledRequests;
    } else if (
      isRequestFile(file) &&
      wasUploadedSince(file, state.lastSeenServerTime)
    ) {
      bucket = digest.requests;
    } else if (isLinkedDelta(file, state)) {
      bucket = digest.linked;
    } else if (
      !isRequestFile(file) &&
      wasUploadedSince(file, state.lastSeenServerTime) &&
      isBotFile(file)
    ) {
      bucket = digest.bots;
    } else if (
      !isRequestFile(file) &&
      wasUploadedSince(file, state.lastSeenServerTime)
    ) {
      bucket = digest.uploads;
    }
    if (bucket) {
      bucket.push(file);
      digest.keys.push(file.key);
    }
  }

  digest.total = digest.keys.length;
  return digest;
}

function buildResumeEntries(files, progressRecords, limit = 3) {
  const byKey = new Map();
  for (const file of files || []) {
    if (file && file.key && !file.expired && !isRequestFile(file)) {
      byKey.set(file.key, file);
    }
  }
  return Array.from(progressRecords || [])
    .map((progress) => ({
      file: byKey.get(progress && progress.fileKey),
      progress,
    }))
    .filter(({ file, progress }) => {
      const hasPosition =
        Object.prototype.hasOwnProperty.call(progress || {}, "page") ||
        Object.prototype.hasOwnProperty.call(progress || {}, "chapter");
      return (
        file &&
        progress &&
        hasPosition &&
        (!file.getReadableType || file.getReadableType())
      );
    })
    .sort((a, b) => {
      const byProgress =
        finiteTimestamp(b.progress.updatedAt) -
        finiteTimestamp(a.progress.updatedAt);
      if (byProgress) {
        return byProgress;
      }
      // Legacy progress did not have updatedAt. Keep it resumable and use the
      // current room's file order as a stable migration fallback.
      return 0;
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = {
  buildActivityDigest,
  buildResumeEntries,
  didCompleteCatchUpDownload,
  isBotFile,
  isLinkedDelta,
  isLinkedFile,
  isOwnUpload,
  isRequestFile,
  linkedSourceId,
  normalizeVisitState,
  wasFulfilledSince,
};
