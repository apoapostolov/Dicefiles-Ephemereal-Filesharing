"use strict";

const { randomUUID } = require("node:crypto");
const { createPluginStateFactory } = require("./state");

function createSessionService({ stateFactory = createPluginStateFactory(), now = Date.now } = {}) {
  const stateFor = roomId => stateFactory({ roomId, pluginId: "room-sessions" });
  const publicSession = (row, memberId) => {
    const { attendees, ...value } = row.value;
    const counts = { going: 0, maybe: 0, declined: 0 };
    for (const state of Object.values(attendees || {})) {
      if (Object.hasOwn(counts, state)) {
        counts[state]++;
      }
    }
    return { ...value, revision: row.version, counts, rsvp: attendees?.[memberId] || "none" };
  };
  const validId = id => {
    if (!/^[a-f0-9-]{36}$/.test(id || "")) {
      throw new Error("Choose a valid session from the room list.");
    } return `session:${id}`;
  };
  return {
    async list(roomId, memberId) {
      const state = stateFor(roomId); const page = await state.list({ prefix: "session:", limit: 100 });
      const rows = await Promise.all(page.entries.map(entry => state.get(entry.key)));
      return rows.filter(row => row && row.value.endsAt > now() - 7 * 86400000).map(row => publicSession(row, memberId)).sort((a, b) => a.startsAt - b.startsAt);
    },
    async create(roomId, input) {
      const title = String(input?.title || "").trim(); const description = String(input?.description || "").trim();
      const startsAt = Number(input?.startsAt); const endsAt = Number(input?.endsAt || startsAt + 2 * 3600000); const timezone = String(input?.timezone || "UTC");
      if (!title || title.length > 120 || description.length > 1000 || !Number.isFinite(startsAt) || startsAt < now() || startsAt > now() + 60 * 86400000 || !Number.isFinite(endsAt) || endsAt <= startsAt || endsAt > startsAt + 86400000) {
        throw new Error("Add a title and a start within 60 days. Sessions must end within 24 hours; descriptions allow 1,000 characters.");
      }
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      }
      catch (_) {
        throw new Error("Choose a valid IANA display timezone, such as Europe/Sofia.");
      }
      const links = Array.isArray(input.links) ? input.links : [];
      if (links.length > 20 || links.some(link => !/^\/(?:g|q|r)\/[a-zA-Z0-9_-]+$/.test(link))) {
        throw new Error("Preparation links must be up to 20 local file, request or room links.");
      }
      const state = stateFor(roomId);
      if ((await state.list({ prefix: "session:", limit: 100 })).entries.length >= 100) {
        throw new Error("This room already has 100 sessions. Wait for old sessions to expire before adding more.");
      }
      const id = randomUUID();
      const row = await state.set(`session:${id}`, { id, title, description, startsAt, endsAt, timezone, links, cancelled: false, attendees: {}, createdAt: now() }, { ifVersion: null, ttlSeconds: Math.ceil((endsAt + 7 * 86400000 - now()) / 1000) });
      return publicSession(row);
    },
    async rsvp(roomId, id, memberId, value) {
      if (!/^[a-zA-Z0-9_-]{20,100}$/.test(memberId || "") || !["going", "maybe", "declined", "none"].includes(value)) {
        throw new Error("Choose Going, Maybe or Declined for this session.");
      }
      const state = stateFor(roomId); const key = validId(id);
      for (let attempts = 0; attempts < 3; attempts++) {
        const row = await state.get(key);
        if (!row || row.value.cancelled || row.value.endsAt <= now()) {
          throw new Error("This session has ended or is cancelled. Refresh the session list.");
        }
        const attendees = { ...(row.value.attendees || {}) };
        if (!attendees[memberId] && Object.keys(attendees).length >= 100) {
          throw new Error("This session has reached its 100-response limit. Contact a room owner.");
        }
        if (value === "none") {
          delete attendees[memberId];
        }
        else {
          attendees[memberId] = value;
        }
        try {
          return publicSession(await state.set(key, { ...row.value, attendees }, { ifVersion: row.version, ttlSeconds: Math.max(60, Math.ceil((row.expiresAt - now()) / 1000)) }), memberId);
        }
        catch (error) {
          if (error.code !== "PLUGIN_STATE_CONFLICT" || attempts === 2) {
            throw error;
          }
        }
      }
    },
    async cancel(roomId, id, expectedRevision, cancelled = true) {
      if (typeof cancelled !== "boolean") {
        throw new Error("Choose Cancel or Restore for this session, then refresh its status.");
      }
      const state = stateFor(roomId); const key = validId(id); const row = await state.get(key);
      if (!row || row.version !== expectedRevision) {
        throw Object.assign(new Error("The session changed. Refresh it before changing its status."), { status: 409 });
      }
      return publicSession(await state.set(key, { ...row.value, cancelled: !!cancelled }, { ifVersion: row.version, ttlSeconds: Math.max(60, Math.ceil((row.expiresAt - now()) / 1000)) }));
    },
  };
}

let service;

function getSessionService() {
  return service ||= createSessionService();
}

async function sessionAction(client, operation, input) {
  if (!client.socket || !client.invited || client.disabled || !await client.room.passwordAccessAllowed(client.user, client.token, client.socket.handshake.cookies || {})) {
    throw new Error("Your room session expired. Refresh the page and sign in again.");
  }
  const invitation = client.room.getRoomPlugins().find(plugin => plugin.id === "session-organizer" && plugin.enabled);
  if (!invitation) {
    return { sessions: [], editable: false, unavailable: true };
  }
  const roomId = client.roomid; const sessions = getSessionService();
  const memberId = require("../room/member-age").memberJoinedAtKey(roomId, client.user?.account ? "account" : "token", client.user?.account || client.token).split(":").pop();

  if (operation === "create" || operation === "cancel") {
    if (!client.privileged) {
      throw new Error("Only a room owner or moderator can plan or cancel sessions.");
    }
    if (operation === "create") {
      await sessions.create(roomId, input);
    }
    else {
      await sessions.cancel(roomId, input.id, input.revision, input.cancelled);
    }
  }
  else if (operation === "rsvp") {
    await sessions.rsvp(roomId, input?.id, memberId, input?.value);
  }
  else if (operation !== "list") {
    throw new Error("Choose a supported session action. Refresh the session list.");
  }
  return { sessions: await sessions.list(roomId, memberId), editable: client.privileged, timezone: invitation.config.timezone || "UTC" };
}

module.exports = { createSessionService, getSessionService, sessionAction };
