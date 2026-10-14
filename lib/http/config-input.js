"use strict";

function mutableConfigValue(value, current) {
  if (typeof value !== typeof current || value === null) {
    return false;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0;
  }
  if (typeof value === "string") {
    return value.length <= 1000;
  }
  return typeof value === "boolean";
}

module.exports = { mutableConfigValue };
