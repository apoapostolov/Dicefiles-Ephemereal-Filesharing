"use strict";

const {
  normalizeLinkedRoomEntries,
  removeLinkedRoomEntry,
} = require("../room/room-links");

function apiError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function getRequiredRoom(Room, roomId) {
  const id = String(roomId || "").trim();
  if (!id) {
    throw apiError("room id is required", 400);
  }
  const room = await Room.get(id);
  if (!room) {
    throw apiError("Unknown room", 404);
  }
  return room;
}

async function listRoomLinks(room) {
  return {
    ok: true,
    roomid: room.roomid,
    links: await room.probeLinkedRooms(),
  };
}

async function createRoomLink(room, body) {
  const payload = body && typeof body === "object" ? body : {};
  const source = String(
    payload.source || payload.sourceRoom || payload.roomId || payload.roomid || "",
  ).trim();
  if (!source) {
    throw apiError("source is required (room id or exact room name)", 400);
  }
  const current = normalizeLinkedRoomEntries(room.config.get("linkedRooms"));
  if (current.some((entry) => entry.roomId === source)) {
    throw apiError("Room link already exists", 409);
  }
  const entry = {
    roomId: source,
    name: typeof payload.name === "string" ? payload.name : undefined,
    rules: payload.rules,
    visibility: payload.visibility,
    allowPrivateSource: payload.allowPrivateSource === true,
  };
  const links = await room.setLinkedRooms(current.concat(entry));
  if (links.length === current.length) {
    throw apiError("Room link already exists", 409);
  }
  return {
    ok: true,
    roomid: room.roomid,
    links,
    statuses: await room.probeLinkedRooms(),
  };
}

async function removeRoomLink(room, sourceRoomId) {
  const source = String(sourceRoomId || "").trim();
  if (!source) {
    throw apiError("source room id is required", 400);
  }
  const current = normalizeLinkedRoomEntries(room.config.get("linkedRooms"));
  if (!current.some((entry) => entry.roomId === source)) {
    throw apiError("Room link not found", 404);
  }
  const links = await room.setLinkedRooms(
    removeLinkedRoomEntry(current, source),
  );
  return {
    ok: true,
    roomid: room.roomid,
    removed: source,
    links,
  };
}

function listGuestInvites(room) {
  return Object.assign(
    {
      ok: true,
      roomid: room.roomid,
    },
    room.getGuestInviteAdminState(),
  );
}

function createGuestInvite(room, body, actor) {
  const payload = body && typeof body === "object" ? body : {};
  const created = room.createGuestInviteLink({
    singleUse: payload.singleUse === true,
    maxUses: payload.maxUses,
    maxAgeHours: payload.maxAgeHours,
    label: payload.label,
    createdBy: actor || "",
  });
  return Object.assign(
    {
      ok: true,
      roomid: room.roomid,
      created,
    },
    room.getGuestInviteAdminState(),
  );
}

function revokeGuestInvite(room, token, actor) {
  const value = String(token || "").trim();
  if (!value) {
    throw apiError("invite token is required", 400);
  }
  const before = room.getGuestInvites();
  if (!before.some((invite) => invite.token === value)) {
    throw apiError("Guest invite not found", 404);
  }
  room.revokeGuestInviteLink(value, actor);
  return Object.assign(
    {
      ok: true,
      roomid: room.roomid,
      revoked: value,
    },
    room.getGuestInviteAdminState(),
  );
}

module.exports = {
  apiError,
  getRequiredRoom,
  listRoomLinks,
  createRoomLink,
  removeRoomLink,
  listGuestInvites,
  createGuestInvite,
  revokeGuestInvite,
};
