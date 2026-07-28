"use strict";

const crypto = require("crypto");

function isStatusPagePrivate(config) {
  return config.get("statusPagePrivate") !== false;
}

function statusPageToken(config) {
  return String(config.get("statusPageToken") || "").trim();
}

function safeTokenMatch(expected, provided) {
  const left = Buffer.from(String(expected || ""), "utf8");
  const right = Buffer.from(String(provided || ""), "utf8");
  if (!left.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function canAccessStatus(config, providedToken) {
  if (!isStatusPagePrivate(config)) {
    return true;
  }
  return safeTokenMatch(statusPageToken(config), providedToken);
}

function statusPageHref(config, includeProtected = false) {
  if (!isStatusPagePrivate(config)) {
    return "/status";
  }
  if (!includeProtected) {
    return "";
  }
  return `/status/${encodeURIComponent(statusPageToken(config))}`;
}

function statusApiHref(config, includeProtected = false) {
  if (!isStatusPagePrivate(config)) {
    return "/api/public/status";
  }
  if (!includeProtected) {
    return "";
  }
  return `/api/public/status/${encodeURIComponent(statusPageToken(config))}`;
}

module.exports = {
  canAccessStatus,
  isStatusPagePrivate,
  safeTokenMatch,
  statusApiHref,
  statusPageHref,
  statusPageToken,
};
