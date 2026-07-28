"use strict";

import "./css/status.css";
const {
  availabilitySegments,
  availabilitySummary,
} = require("../common/status-history");
const {
  formatByteTick,
  niceByteAxis,
  niceNumberAxis,
  smoothPointPath,
} = require("../common/status-charts");

const initialNode = document.getElementById("status-initial-data");
const chart = document.getElementById("status-history-chart");
const requestChart = document.getElementById("status-request-chart");
const { statusApi } = document.body.dataset;
const STATUS_REFRESH_MS = Math.max(
  60,
  Number(document.body.dataset.statusRefreshSeconds) || 5 * 60,
) * 1000;
const SVG_NS = "http://www.w3.org/2000/svg";
let lastStatus = null;
let lastRefreshAttemptAt = Date.now();
let refreshInFlight = null;
let refreshTimer = null;
let refreshStopped = false;

function atPath(data, path) {
  return path.split(".").reduce((value, key) => value && value[key], data);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "Unavailable";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = n;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) {
    amount /= 1000;
    unit++;
  }
  const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unit]}`;
}

function formatDuration(value) {
  let seconds = Math.max(0, Number(value) || 0);
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  if (days) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatField(path, value) {
  if (
    path.endsWith("Bytes") ||
    path === "capacity.disk.freeBytes" ||
    path === "capacity.disk.totalBytes" ||
    path === "capacity.uploads.logicalBytes"
  ) {
    return formatBytes(value);
  }
  if (path === "service.uptimeSec") {
    return formatDuration(value);
  }
  if (path === "generatedAt") {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (path === "activity.since") {
    return new Date(value).toLocaleString();
  }
  if (path === "service.status") {
    return String(value || "unknown");
  }
  if (path === "capacity.disk.usedPercent") {
    return value == null ? "—" : `${value}%`;
  }
  if (path === "requests.current.fulfillmentPercent") {
    return value == null ? "—" : `${value}%`;
  }
  if (
    path === "requests.current.medianFulfillmentSec" ||
    path === "requests.current.oldestOpenSec"
  ) {
    return value == null ? "—" : formatDuration(value);
  }
  return formatNumber(value);
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}

function svgText(attributes, text) {
  const node = svg("text", attributes);
  node.textContent = text;
  return node;
}

function renderChart(points) {
  const oldPlot = chart.querySelector("[data-chart-plot]");
  if (oldPlot) {
    oldPlot.remove();
  }
  const plot = svg("g", { "data-chart-plot": "" });
  chart.append(plot);

  const empty = document.querySelector("[data-history-empty]");
  const width = 900;
  const height = 260;
  const left = 76;
  const right = 16;
  const top = 18;
  const bottom = 28;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const totalTraffic = points.reduce(
    (sum, point) =>
      sum +
      (Number(point.uploadedBytes) || 0) +
      (Number(point.downloadedBytes) || 0),
    0,
  );
  empty.hidden = totalTraffic > 0;
  const maxValue = Math.max(
    ...points.map(point =>
      Math.max(
        Number(point.uploadedBytes) || 0,
        Number(point.downloadedBytes) || 0,
      ),
    ),
    0,
  );
  const axis = niceByteAxis(maxValue, 5);
  const x = (_point, index) =>
    left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = value =>
    top + innerHeight - ((Number(value) || 0) / axis.max) * innerHeight;

  for (const tick of axis.ticks) {
    const gridY = y(tick);
    plot.append(
      svg("line", {
        class: "chart-grid",
        x1: left,
        x2: width - right,
        y1: gridY,
        y2: gridY,
      }),
      svgText(
        {
          "class": "chart-axis-label",
          "x": left - 10,
          "y": gridY + 3,
          "text-anchor": "end",
        },
        formatByteTick(tick),
      ),
    );
  }

  if (points.length > 1) {
    const uploadedCoordinates = points.map((point, index) => ({
      x: x(point, index),
      y: y(point.uploadedBytes),
    }));
    const downloadedCoordinates = points.map((point, index) => ({
      x: x(point, index),
      y: y(point.downloadedBytes),
    }));
    plot.append(
      svg("path", {
        class: "chart-traffic-line chart-uploaded-line",
        d: smoothPointPath(uploadedCoordinates),
      }),
      svg("path", {
        class: "chart-traffic-line chart-downloaded-line",
        d: smoothPointPath(downloadedCoordinates),
      }),
    );
  }

  document.querySelector("[data-history-start]").textContent = "5 days ago";
  document.querySelector("[data-history-end]").textContent = "Now";
  document.querySelector("[data-history-count]").textContent =
    `${points.length} two-hour periods`;
  document.getElementById("history-chart-desc").textContent =
    `${formatBytes(points.reduce(
      (sum, point) => sum + (Number(point.uploadedBytes) || 0),
      0,
    ))} uploaded and ${formatBytes(points.reduce(
      (sum, point) => sum + (Number(point.downloadedBytes) || 0),
      0,
    ))} downloaded during the last five days.`;
}

function renderRequestChart(points) {
  const oldPlot = requestChart.querySelector("[data-request-chart-plot]");
  if (oldPlot) {
    oldPlot.remove();
  }
  const plot = svg("g", { "data-request-chart-plot": "" });
  requestChart.append(plot);

  const empty = document.querySelector("[data-request-empty]");
  const unfulfilledPeak = Math.max(
    ...points.map(point => Number(point.unfulfilled) || 0),
    0,
  );
  const fulfilledPeak = Math.max(
    ...points.map(point => Number(point.fulfilled) || 0),
    0,
  );
  const hasActivity = unfulfilledPeak + fulfilledPeak > 0;
  empty.hidden = hasActivity;

  const width = 900;
  const height = 260;
  const left = 52;
  const right = 16;
  const top = 18;
  const bottom = 28;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const countMax = Math.max(
    ...points.map(
      point =>
        (Number(point.unfulfilled) || 0) + (Number(point.fulfilled) || 0),
    ),
    0,
  );
  const axis = niceNumberAxis(countMax, 4, 1);
  const groupWidth = innerWidth / points.length;
  const barWidth = Math.max(3, Math.min(12, groupWidth * 0.72));
  const baseline = height - bottom;
  const y = value =>
    top + innerHeight - ((Number(value) || 0) / axis.max) * innerHeight;

  for (const tick of axis.ticks) {
    const gridY = y(tick);
    plot.append(
      svg("line", {
        class: "chart-grid",
        x1: left,
        x2: width - right,
        y1: gridY,
        y2: gridY,
      }),
      svgText(
        {
          "class": "chart-axis-label",
          "x": left - 10,
          "y": gridY + 3,
          "text-anchor": "end",
        },
        formatNumber(tick),
      ),
    );
  }

  points.forEach((point, index) => {
    const center = left + index * groupWidth + groupWidth / 2;
    const unfulfilled = Number(point.unfulfilled) || 0;
    const fulfilled = Number(point.fulfilled) || 0;
    const unfulfilledHeight = (unfulfilled / axis.max) * innerHeight;
    const fulfilledHeight = (fulfilled / axis.max) * innerHeight;
    const unfulfilledY = baseline - unfulfilledHeight;
    const fulfilledY = unfulfilledY - fulfilledHeight;
    const group = svg("g", { class: "request-period" });
    group.append(
      svg("rect", {
        class: "request-unfulfilled-bar",
        x: center - barWidth / 2,
        y: unfulfilledY,
        width: barWidth,
        height: Math.max(0, unfulfilledHeight),
        rx: 1,
      }),
      svg("rect", {
        class: "request-fulfilled-bar",
        x: center - barWidth / 2,
        y: fulfilledY,
        width: barWidth,
        height: Math.max(0, fulfilledHeight),
        rx: 1,
      }),
    );
    const title = svg("title");
    title.textContent =
      `${new Date(point.at).toLocaleString()}: ${unfulfilled} unfulfilled, ` +
      `${fulfilled} fulfilled`;
    group.append(title);
    plot.append(group);
  });

  if (!points.length) {
    document.querySelector("[data-request-start]").textContent = "5 days ago";
    document.querySelector("[data-request-end]").textContent = "Now";
    document.querySelector("[data-request-count]").textContent =
      "0 two-hour periods";
    document.getElementById("request-chart-desc").textContent =
      "No request availability has been recorded in this five-day window.";
    return;
  }
  const first = points[0];
  document.querySelector("[data-request-start]").textContent = "5 days ago";
  document.querySelector("[data-request-end]").textContent = "Now";
  document.querySelector("[data-request-count]").textContent =
    `${points.length} two-hour periods`;
  document.getElementById("request-chart-desc").textContent =
    "Request availability across all rooms in two-hour periods during the " +
    `last five days, from ${new Date(first.at).toLocaleString()}. Yellow is ` +
    "unfulfilled and green is fulfilled.";
}

function renderComponents(data) {
  for (const item of data.components || []) {
    const node = document.querySelector(`[data-component="${item.id}"]`);
    if (!node) {
      continue;
    }
    node.dataset.status = item.status;
    node.querySelector(".component-latency").textContent =
      item.latencyMs == null ? "—" : `${item.latencyMs} ms`;
    node.querySelector(".component-state").textContent = item.status;
  }
  const previews = document.querySelector("[data-component=\"previews\"]");
  previews.dataset.status = data.pipeline.status;
  previews.querySelector(".component-state").textContent = data.pipeline.status;
}

function segmentTitle(segment) {
  const options = { hour: "2-digit", minute: "2-digit" };
  const start = new Date(segment.startAt).toLocaleTimeString([], options);
  const end = new Date(segment.endAt).toLocaleTimeString([], options);
  const state = segment.status.charAt(0).toUpperCase() + segment.status.slice(1);
  return `${start}–${end}: ${state}`;
}

function renderAvailability(data) {
  const track = document.querySelector("[data-status-track]");
  const points = [
    ...((data.history && data.history.points) || []),
    { at: data.generatedAt, status: data.service.status },
  ];
  const segments = availabilitySegments(
    points,
    Date.parse(data.generatedAt),
  );
  const summary = availabilitySummary(segments);
  track.replaceChildren(
    ...segments.map(segment => {
      const node = document.createElement("span");
      node.dataset.status = segment.status;
      node.title = segmentTitle(segment);
      node.setAttribute("aria-hidden", "true");
      return node;
    }),
  );
  const knownDescription = summary.knownSegments ?
    `${summary.operationalPercent}% recorded uptime` :
    "Collecting history";
  document.querySelector("[data-availability-summary]").textContent =
    knownDescription;
  track.setAttribute(
    "aria-label",
    summary.knownSegments ?
      `Service status over the last 24 hours. ${knownDescription}.` :
      "Service status history is beginning now.",
  );
}

function render(data) {
  lastStatus = data;
  document.body.dataset.serviceStatus = data.service.status;
  for (const node of document.querySelectorAll("[data-field]")) {
    const path = node.dataset.field;
    const value = atPath(data, path);
    node.textContent = formatField(path, value);
    if (node.tagName === "TIME" && value) {
      node.dateTime = value;
    }
  }
  const used = data.capacity.disk.usedPercent;
  const fill = document.querySelector("[data-capacity-fill]");
  fill.style.width = `${used == null ? 0 : used}%`;
  fill.parentElement.setAttribute(
    "aria-label",
    used == null ? "Storage use unavailable" : `${used}% of drive used`,
  );
  document.querySelector(".capacity-orbit").style.setProperty(
    "--capacity-used",
    `${(used == null ? 0 : used) * 3.6}deg`,
  );
  const requestPercent = data.requests.current.fulfillmentPercent;
  const requestOrbit = document.querySelector(".request-orbit");
  requestOrbit.style.setProperty(
    "--request-fulfilled",
    `${(requestPercent == null ? 0 : requestPercent) * 3.6}deg`,
  );
  requestOrbit.setAttribute(
    "aria-label",
    requestPercent == null ?
      "No current requests" :
      `${requestPercent}% of current requests fulfilled across all rooms`,
  );
  renderComponents(data);
  renderAvailability(data);
  renderChart(
    (data.history &&
      data.history.traffic &&
      data.history.traffic.points) ||
      [],
  );
  renderRequestChart(
    (data.requests && data.requests.timeline && data.requests.timeline.points) ||
      [],
  );
}

function refresh() {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    lastRefreshAttemptAt = Date.now();
    try {
      const response = await fetch(statusApi, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Status request failed (${response.status})`);
      }
      render(await response.json());
    }
    catch (ex) {
      console.warn(ex);
      if (lastStatus) {
        document.body.dataset.serviceStatus = "stale";
      }
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function scheduleRefresh(delay = STATUS_REFRESH_MS) {
  if (refreshStopped) {
    return;
  }
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(async () => {
    refreshTimer = null;
    if (!document.hidden) {
      await refresh();
    }
    if (!refreshStopped) {
      scheduleRefresh();
    }
  }, Math.max(1000, delay));
}

try {
  render(JSON.parse(initialNode.textContent));
}
catch (ex) {
  console.warn("Could not read initial status data", ex);
  refresh();
}

scheduleRefresh();

window.addEventListener(
  "pagehide",
  () => {
    refreshStopped = true;
    window.clearTimeout(refreshTimer);
  },
  { once: true },
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const elapsed = Date.now() - lastRefreshAttemptAt;
    if (elapsed >= STATUS_REFRESH_MS) {
      refresh().finally(() => scheduleRefresh());
    }
    else {
      scheduleRefresh(STATUS_REFRESH_MS - elapsed);
    }
  }
});
