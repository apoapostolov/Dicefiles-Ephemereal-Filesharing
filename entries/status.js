"use strict";

import "./css/status.css";
const {
  availabilitySegments,
  availabilitySummary,
} = require("../common/status-history");

const initialNode = document.getElementById("status-initial-data");
const chart = document.getElementById("status-history-chart");
const requestChart = document.getElementById("status-request-chart");
const { statusApi } = document.body.dataset;
const SVG_NS = "http://www.w3.org/2000/svg";
let lastStatus = null;

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

function pointPath(points, x, y) {
  return points.
    map((point, index) => `${index ? "L" : "M"}${x(point, index)},${y(point)}`).
    join(" ");
}

function renderChart(points) {
  const oldPlot = chart.querySelector("[data-chart-plot]");
  if (oldPlot) {
    oldPlot.remove();
  }
  const plot = svg("g", { "data-chart-plot": "" });
  chart.append(plot);

  const empty = document.querySelector("[data-history-empty]");
  empty.hidden = points.length > 1;
  if (!points.length) {
    return;
  }

  const width = 900;
  const height = 260;
  const left = 18;
  const right = 18;
  const top = 22;
  const bottom = 34;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const storageMax = Math.max(...points.map(point => point.storageBytes || 0), 1);
  const peopleMax = Math.max(...points.map(point => point.usersOnline || 0), 1);
  const x = (_point, index) =>
    left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yStorage = point =>
    top + innerHeight - ((point.storageBytes || 0) / storageMax) * innerHeight;
  const yPeople = point =>
    top + innerHeight - ((point.usersOnline || 0) / peopleMax) * innerHeight;

  for (let row = 0; row <= 4; row++) {
    const y = top + (row / 4) * innerHeight;
    plot.append(
      svg("line", {
        class: "chart-grid",
        x1: left,
        x2: width - right,
        y1: y,
        y2: y,
      }),
    );
  }

  if (points.length > 1) {
    const storageLine = pointPath(points, x, yStorage);
    const area = `${storageLine} L${x(points.at(-1), points.length - 1)},${height - bottom} L${x(points[0], 0)},${height - bottom} Z`;
    plot.append(svg("path", { class: "chart-storage-area", d: area }));
    plot.append(svg("path", { class: "chart-storage-line", d: storageLine }));
    plot.append(
      svg("path", {
        class: "chart-people-line",
        d: pointPath(points, x, yPeople),
      }),
    );
  }

  const latest = points.at(-1);
  const latestX = x(latest, points.length - 1);
  plot.append(
    svg("circle", {
      class: "chart-storage-dot",
      cx: latestX,
      cy: yStorage(latest),
      r: 5,
    }),
  );
  plot.append(
    svg("circle", {
      class: "chart-people-dot",
      cx: latestX,
      cy: yPeople(latest),
      r: 4,
    }),
  );

  document.querySelector("[data-history-start]").textContent = new Date(
    points[0].at,
  ).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  document.querySelector("[data-history-end]").textContent = new Date(
    latest.at,
  ).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  document.querySelector("[data-history-count]").textContent =
    `${points.length} ${points.length === 1 ? "sample" : "samples"}`;
}

function renderRequestChart(points) {
  const oldPlot = requestChart.querySelector("[data-request-chart-plot]");
  if (oldPlot) {
    oldPlot.remove();
  }
  const plot = svg("g", { "data-request-chart-plot": "" });
  requestChart.append(plot);

  const empty = document.querySelector("[data-request-empty]");
  const opened = points.reduce((sum, point) => sum + (point.opened || 0), 0);
  const fulfilled = points.reduce(
    (sum, point) => sum + (point.fulfilled || 0),
    0,
  );
  const hasActivity = opened + fulfilled > 0;
  empty.hidden = hasActivity;
  if (!points.length) {
    return;
  }

  const width = 900;
  const height = 260;
  const left = 18;
  const right = 18;
  const top = 22;
  const bottom = 34;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const countMax = Math.max(
    ...points.map(point => Math.max(point.opened || 0, point.fulfilled || 0)),
    1,
  );
  const groupWidth = innerWidth / points.length;
  const barWidth = Math.max(3, Math.min(13, groupWidth * 0.3));
  const baseline = height - bottom;
  const y = value =>
    top + innerHeight - ((Number(value) || 0) / countMax) * innerHeight;

  for (let row = 0; row <= 4; row++) {
    const gridY = top + (row / 4) * innerHeight;
    plot.append(
      svg("line", {
        class: "chart-grid",
        x1: left,
        x2: width - right,
        y1: gridY,
        y2: gridY,
      }),
    );
  }

  points.forEach((point, index) => {
    const center = left + index * groupWidth + groupWidth / 2;
    const openedY = y(point.opened);
    const fulfilledY = y(point.fulfilled);
    plot.append(
      svg("rect", {
        class: "request-opened-bar",
        x: center - barWidth - 1,
        y: openedY,
        width: barWidth,
        height: Math.max(0, baseline - openedY),
        rx: 1,
      }),
    );
    plot.append(
      svg("rect", {
        class: "request-fulfilled-bar",
        x: center + 1,
        y: fulfilledY,
        width: barWidth,
        height: Math.max(0, baseline - fulfilledY),
        rx: 1,
      }),
    );
  });

  const first = points[0];
  const latest = points.at(-1);
  document.querySelector("[data-request-start]").textContent = new Date(
    first.at,
  ).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  document.querySelector("[data-request-end]").textContent = "Now";
  document.querySelector("[data-request-count]").textContent =
    `${points.length} ${points.length === 1 ? "bucket" : "hourly buckets"}`;
  document.getElementById("request-chart-desc").textContent =
    `${opened} requests opened and ${fulfilled} fulfilled across all rooms ` +
    `between ${new Date(first.at).toLocaleString()} and ` +
    `${new Date(latest.at).toLocaleString()}.`;
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
    used == null ? "Drive usage unavailable" : `${used}% of drive used`,
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
      `${requestPercent}% of current requests fulfilled globally`,
  );
  renderComponents(data);
  renderAvailability(data);
  renderChart((data.history && data.history.points) || []);
  renderRequestChart(
    (data.requests && data.requests.timeline && data.requests.timeline.points) ||
      [],
  );
}

async function refresh() {
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
}

try {
  render(JSON.parse(initialNode.textContent));
}
catch (ex) {
  console.warn("Could not read initial status data", ex);
  refresh();
}

const timer = window.setInterval(() => {
  if (!document.hidden) {
    refresh();
  }
}, 30 * 1000);

window.addEventListener("pagehide", () => window.clearInterval(timer), {
  once: true,
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refresh();
  }
});
