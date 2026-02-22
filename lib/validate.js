"use strict";

/**
 * lib/validate.js — Centralized server-side input validation helpers.
 *
 * P0.5 — 3.4: All user-supplied string inputs should be validated through
 * these helpers to ensure consistent enforcement of length limits and
 * format requirements, reducing XSS/injection surface.
 */

/**
 * Normalize and validate a required string field.
 * Throws if blank or exceeds maxLen.
 *
 * @param {*}       v       Raw value from req.body / req.query
 * @param {string}  name    Human-readable field name for error messages
 * @param {number}  maxLen  Maximum allowed byte-length (default 8000)
 * @returns {string} Trimmed, validated string
 */
function requireString(v, name, maxLen = 8000) {
  const s = (v == null ? "" : String(v)).trim();
  if (!s) {
    throw new Error(`${name} is required`);
  }
  if (s.length > maxLen) {
    throw new Error(`${name} is too long (maximum ${maxLen} characters)`);
  }
  return s;
}

/**
 * Normalize an optional string field.
 * Returns empty string if absent; throws only on length excess.
 *
 * @param {*}      v      Raw value
 * @param {number} maxLen Maximum allowed byte-length (default 8000)
 * @returns {string} Trimmed string, possibly empty
 */
function optionalString(v, maxLen = 8000) {
  if (v == null || v === "") {
    return "";
  }
  const s = String(v).trim();
  if (s.length > maxLen) {
    throw new Error(`Value is too long (maximum ${maxLen} characters)`);
  }
  return s;
}

/**
 * Validate a room ID (alphanumeric + hyphen/underscore, 1-64 chars).
 *
 * @param {*} v Raw value
 * @returns {string} Lowercased room ID
 */
function requireRoomId(v) {
  const s = requireString(v, "roomid", 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) {
    throw new Error(
      "Invalid room ID — only letters, digits, hyphens, and underscores are allowed",
    );
  }
  return s.toLowerCase();
}

/**
 * Validate a username / nick (non-empty, max 32 chars, printable).
 *
 * @param {*} v Raw value
 * @returns {string} Trimmed username
 */
function requireNick(v) {
  return requireString(v, "username", 32);
}

/**
 * Password strength validator (P0.5 — 3.2).
 *
 * Requirements:
 *   - At least 12 characters
 *   - At least one uppercase letter (A-Z)
 *   - At least one lowercase letter (a-z)
 *   - At least one digit (0-9)
 *
 * Throws descriptively on the first failing rule.
 *
 * @param {string} pass Raw password supplied by the user
 */
function validatePassword(pass) {
  if (!pass || pass.length < 12) {
    throw new Error("Password must be at least 12 characters long");
  }
  if (!/[A-Z]/.test(pass)) {
    throw new Error("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(pass)) {
    throw new Error("Password must contain at least one lowercase letter");
  }
  if (!/\d/.test(pass)) {
    throw new Error("Password must contain at least one digit");
  }
}

module.exports = {
  requireString,
  optionalString,
  requireRoomId,
  requireNick,
  validatePassword,
};
