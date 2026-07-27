"use strict";

/**
 * Pure upload tag/metadata sanitization (no Redis / storage deps).
 */

function sanitizeTagValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let out = value.toString();
  out = out.replace(/<[^>]*>/g, " ");
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/```+/g, " ");
  out = out.replace(/`([^`]*)`/g, "$1");
  out = out.replace(/(^|\s)[*_~#>]+(?=\S)/g, "$1");
  out = out.replace(/^\s*[-+*]\s+/gm, "");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 200) {
    out = `${out.slice(0, 199)}…`;
  }
  return out;
}

module.exports = {
  sanitizeTagValue,
};
