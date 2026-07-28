"use strict";

const crypto = require("crypto");
const CONFIG = require("../config");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NEW_ROOM_MEMBER_DAYS = 7;
const MAX_NEW_ROOM_MEMBER_DAYS = 3650;

function getNewRoomMemberDays(value = CONFIG.get("newRoomMemberDays")) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_NEW_ROOM_MEMBER_DAYS;
  }
  return Math.min(
    MAX_NEW_ROOM_MEMBER_DAYS,
    Math.max(0, Math.floor(parsed)),
  );
}

function memberJoinedAtKey(roomId, kind, value) {
  if (!value) {
    return "";
  }
  const digest = crypto.createHmac("sha256", String(CONFIG.get("secret") || "")).
    update(`${roomId}\0${kind}\0${String(value)}`).
    digest("base64url");
  return `memberJoinedAt:${digest}`;
}

function isNewRoomMember(joinedAt, now = Date.now(), days) {
  const joined = Number(joinedAt);
  const thresholdDays = getNewRoomMemberDays(days);
  if (!Number.isFinite(joined) || joined <= 0 || thresholdDays <= 0) {
    return false;
  }
  const age = now - joined;
  return age >= 0 && age < thresholdDays * DAY_MS;
}

function decorateNewRoomMember(file, now = Date.now(), days) {
  if (!file || !file.meta || typeof file.meta !== "object") {
    return file;
  }
  const meta = Object.assign({}, file.meta);
  const joinedAt = meta.roomMemberJoinedAt;
  delete meta.roomMemberJoinedAt;
  delete meta.newRoomMember;
  delete meta.newRoomMemberDays;
  if (isNewRoomMember(joinedAt, now, days)) {
    meta.newRoomMember = true;
    meta.newRoomMemberDays = getNewRoomMemberDays(days);
  }
  file.meta = meta;
  return file;
}

module.exports = {
  DAY_MS,
  DEFAULT_NEW_ROOM_MEMBER_DAYS,
  decorateNewRoomMember,
  getNewRoomMemberDays,
  isNewRoomMember,
  memberJoinedAtKey,
};
