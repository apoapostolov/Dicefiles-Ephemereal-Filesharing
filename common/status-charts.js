"use strict";

const MB = 1000 * 1000;
const GB = 1000 * MB;
const TB = 1000 * GB;

function niceNumberAxis(maxValue, desiredIntervals = 5, minimumStep = 0) {
  const max = Math.max(0, Number(maxValue) || 0);
  const intervals = Math.max(2, Math.floor(Number(desiredIntervals) || 5));
  const minStep = Math.max(0, Number(minimumStep) || 0);
  const rawStep = Math.max(minStep || Number.EPSILON, max / intervals);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(minStep, factor * magnitude);
  const axisMax = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let value = 0; value <= axisMax + step / 2; value += step) {
    ticks.push(value);
  }
  return { max: axisMax, step, ticks };
}

function niceByteAxis(maxValue, desiredIntervals = 5) {
  return niceNumberAxis(maxValue, desiredIntervals, MB);
}

function formatByteTick(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) {
    return "0";
  }
  const unit = bytes >= TB ? TB : bytes >= GB ? GB : MB;
  const suffix = unit === TB ? "TB" : unit === GB ? "GB" : "MB";
  const amount = bytes / unit;
  const digits = Number.isInteger(amount) ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${suffix}`;
}

function smoothPointPath(points, tension = 0.82) {
  if (!Array.isArray(points) || !points.length) {
    return "";
  }
  if (points.length === 1) {
    return `M${points[0].x},${points[0].y}`;
  }
  const safeTension = Math.max(0, Math.min(1, Number(tension) || 0));
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const control1X =
      current.x + ((next.x - before.x) / 6) * safeTension;
    const control2X =
      next.x - ((after.x - current.x) / 6) * safeTension;
    const lowY = Math.min(current.y, next.y);
    const highY = Math.max(current.y, next.y);
    const control1Y = Math.max(
      lowY,
      Math.min(highY, current.y + ((next.y - before.y) / 6) * safeTension),
    );
    const control2Y = Math.max(
      lowY,
      Math.min(highY, next.y - ((after.y - current.y) / 6) * safeTension),
    );
    path +=
      ` C${control1X},${control1Y} ${control2X},${control2Y} ` +
      `${next.x},${next.y}`;
  }
  return path;
}

module.exports = {
  MB,
  GB,
  TB,
  formatByteTick,
  niceByteAxis,
  niceNumberAxis,
  smoothPointPath,
};
