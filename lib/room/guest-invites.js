"use strict";

/**
 * Guest invite links — pure token state (no Redis I/O).
 *
 * Modes:
 * - singleUse: maxUses forced to 1 (expires after one successful redeem)
 * - maxUses: up to X successful redemptions
 * - maxAgeHours: absolute expiry from creation time
 *
 * URL form (wired elsewhere): /r/<roomId>?invite=<token>
 */

const crypto = require("crypto");

const DEFAULT_MAX_USES = 1;
const MAX_MAX_USES = 10000;
const MAX_AGE_HOURS = 24 * 90; // 90 days cap

/**
 * @param {number} [bytes]
 * @returns {string}
 */
function generateInviteToken(bytes) {
  const n = Math.min(48, Math.max(16, Number(bytes) || 24));
  return crypto.randomBytes(n).toString("base64url");
}

/**
 * Normalize a stored invite list.
 * @param {unknown} raw
 * @returns {object[]}
 */
function normalizeGuestInvites(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const token = String(item.token || "").trim();
    if (!token || token.length < 8 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    const maxUses = clampInt(item.maxUses, DEFAULT_MAX_USES, 1, MAX_MAX_USES);
    const uses = clampInt(item.uses, 0, 0, MAX_MAX_USES);
    const createdAt = Number(item.createdAt) || 0;
    let expiresAt = item.expiresAt == null ? null : Number(item.expiresAt);
    if (expiresAt != null && !Number.isFinite(expiresAt)) {
      expiresAt = null;
    }
    out.push({
      token,
      maxUses,
      uses,
      createdAt,
      expiresAt,
      singleUse: item.singleUse === true || maxUses === 1,
      label:
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim().slice(0, 80)
          : "",
      createdBy:
        typeof item.createdBy === "string" ? item.createdBy.slice(0, 64) : "",
    });
  }
  return out;
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Create a new invite record (pure).
 * @param {{
 *   singleUse?: boolean,
 *   maxUses?: number,
 *   maxAgeHours?: number|null,
 *   label?: string,
 *   createdBy?: string,
 *   now?: number,
 *   token?: string
 * }} opts
 * @returns {object}
 */
function createGuestInvite(opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  let maxUses = clampInt(o.maxUses, DEFAULT_MAX_USES, 1, MAX_MAX_USES);
  const singleUse = o.singleUse === true || maxUses === 1;
  if (singleUse) {
    maxUses = 1;
  }
  let expiresAt = null;
  if (o.maxAgeHours != null && o.maxAgeHours !== "") {
    const hours = Number(o.maxAgeHours);
    if (Number.isFinite(hours) && hours > 0) {
      const h = Math.min(MAX_AGE_HOURS, Math.max(1 / 60, hours)); // min ~1 min as fraction ok
      expiresAt = now + Math.ceil(h * 3600 * 1000);
    }
  }
  return {
    token: o.token || generateInviteToken(),
    maxUses,
    uses: 0,
    createdAt: now,
    expiresAt,
    singleUse,
    label: typeof o.label === "string" ? o.label.trim().slice(0, 80) : "",
    createdBy: typeof o.createdBy === "string" ? o.createdBy.slice(0, 64) : "",
  };
}

/**
 * Is this invite still redeemable at `now`?
 * @param {object} invite
 * @param {number} [now]
 * @returns {{ok: boolean, reason?: string}}
 */
function inviteRedeemability(invite, now) {
  if (!invite || !invite.token) {
    return { ok: false, reason: "invalid" };
  }
  const t = Number.isFinite(now) ? now : Date.now();
  if (invite.expiresAt != null && t >= Number(invite.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  const uses = Number(invite.uses) || 0;
  const maxUses = Number(invite.maxUses) || 1;
  if (uses >= maxUses) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true };
}

/**
 * Find invite by token in a list.
 * @param {unknown} list
 * @param {string} token
 * @returns {object|null}
 */
function findGuestInvite(list, token) {
  const t = String(token || "").trim();
  if (!t) {
    return null;
  }
  return normalizeGuestInvites(list).find((i) => i.token === t) || null;
}

/**
 * Redeem once: returns new list + redeemed invite, or failure.
 * @param {unknown} list
 * @param {string} token
 * @param {number} [now]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   invites: object[],
 *   invite?: object
 * }}
 */
function redeemGuestInvite(list, token, now) {
  const invites = normalizeGuestInvites(list);
  const t = String(token || "").trim();
  if (!t) {
    return { ok: false, reason: "invalid", invites };
  }
  const idx = invites.findIndex((i) => i.token === t);
  if (idx < 0) {
    return { ok: false, reason: "not_found", invites };
  }
  const invite = Object.assign({}, invites[idx]);
  const check = inviteRedeemability(invite, now);
  if (!check.ok) {
    return { ok: false, reason: check.reason, invites, invite };
  }
  invite.uses = (Number(invite.uses) || 0) + 1;
  const next = invites.slice();
  next[idx] = invite;
  return { ok: true, invites: next, invite };
}

/**
 * Public-safe view (token truncated for lists, or full for mint response).
 * @param {object} invite
 * @param {{fullToken?: boolean}} [opts]
 * @returns {object}
 */
function serializeGuestInvite(invite, opts) {
  if (!invite) {
    return null;
  }
  const full = opts && opts.fullToken;
  const token = String(invite.token || "");
  return {
    token: full ? token : token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : "…",
    tokenFull: full ? token : undefined,
    maxUses: invite.maxUses,
    uses: invite.uses,
    remaining: Math.max(0, (invite.maxUses || 1) - (invite.uses || 0)),
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    singleUse: !!invite.singleUse,
    label: invite.label || "",
    createdBy: invite.createdBy || "",
    status: inviteRedeemability(invite).ok
      ? "active"
      : inviteRedeemability(invite).reason || "inactive",
  };
}

/**
 * Build share path (relative).
 * @param {string} roomId
 * @param {string} token
 * @returns {string}
 */
function guestInvitePath(roomId, token) {
  const r = encodeURIComponent(String(roomId || ""));
  const t = encodeURIComponent(String(token || ""));
  return `/r/${r}?invite=${t}`;
}

/**
 * Revoke by token.
 * @param {unknown} list
 * @param {string} token
 * @returns {object[]}
 */
function revokeGuestInvite(list, token) {
  const t = String(token || "").trim();
  return normalizeGuestInvites(list).filter((i) => i.token !== t);
}

module.exports = {
  DEFAULT_MAX_USES,
  MAX_MAX_USES,
  MAX_AGE_HOURS,
  generateInviteToken,
  normalizeGuestInvites,
  createGuestInvite,
  inviteRedeemability,
  findGuestInvite,
  redeemGuestInvite,
  serializeGuestInvite,
  guestInvitePath,
  revokeGuestInvite,
};
