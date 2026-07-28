"use strict";

const AVAILABILITY_SEGMENTS = 48;
const AVAILABILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_SEVERITY = Object.freeze({
  unknown: 0,
  operational: 1,
  degraded: 2,
  outage: 3,
});

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_SEVERITY, status) ?
    status :
    "unknown";
}

function availabilitySegments(
    points,
    nowValue,
    count = AVAILABILITY_SEGMENTS,
    windowMs = AVAILABILITY_WINDOW_MS,
) {
  const now = Number.isFinite(Number(nowValue)) ?
    Number(nowValue) :
    Date.now();
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const safeWindow = Math.max(safeCount, Number(windowMs) || 1);
  const start = now - safeWindow;
  const bucketMs = safeWindow / safeCount;
  const segments = Array.from({ length: safeCount }, (_, index) => ({
    startAt: new Date(start + index * bucketMs).toISOString(),
    endAt: new Date(start + (index + 1) * bucketMs).toISOString(),
    status: "unknown",
    samples: 0,
  }));

  for (const point of points || []) {
    const at = Date.parse(point && point.at);
    if (!Number.isFinite(at) || at < start || at > now) {
      continue;
    }
    const index = Math.min(
      safeCount - 1,
      Math.max(0, Math.floor((at - start) / bucketMs)),
    );
    const status = normalizeStatus(point.status);
    const segment = segments[index];
    segment.samples++;
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[segment.status]) {
      segment.status = status;
    }
  }
  return segments;
}

function availabilitySummary(segments) {
  const known = (segments || []).filter(segment => segment.status !== "unknown");
  const operational = known.filter(
    segment => segment.status === "operational",
  ).length;
  return {
    knownSegments: known.length,
    operationalPercent: known.length ?
      Math.round((operational / known.length) * 1000) / 10 :
      null,
  };
}

module.exports = {
  AVAILABILITY_SEGMENTS,
  AVAILABILITY_WINDOW_MS,
  availabilitySegments,
  availabilitySummary,
  normalizeStatus,
};
