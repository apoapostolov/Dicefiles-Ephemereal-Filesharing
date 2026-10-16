"use strict";

const { createHash } = require("node:crypto");

const revision = file => {
  const meta = { ...require("./metadata").publicMetadata(file.meta) };
  // Room-member badges decorate the view and are not file edits.
  delete meta.roomMemberJoinedAt; delete meta.newRoomMember; delete meta.newRoomMemberDays;
  return createHash("sha256").update(JSON.stringify({ key: file.key, name: file.name, hash: file.hash, tags: file.tags, meta, expires: file.expires, status: file.status, claimedBy: file.claimedBy, claimedUntil: file.claimedUntil, fulfilledAt: file.fulfilledAt, hints: file.hints })).digest("hex");
};
const conflict = () => Object.assign(new Error("This item changed after the report was prepared. Refresh the report before applying this action."), { status: 409, retryable: false });

function createWorkflowApi({ getRoom, uploads, requests, broker, onRequestFulfilled, auditStateFactory = require("./state").createPluginStateFactory() } = {}) {
  const roomFor = async spec => {
    const room = await getRoom(spec?.roomId);
    if (!room) {
      throw Object.assign(new Error("Room is unavailable. Check the bot invitation."), { status: 404 });
    }
    return room;
  };
  const fileMap = () => {
    if (uploads) {
      return uploads;
    }
    const { UPLOADS, Upload } = require("../upload");

    return { updateAtomic: UPLOADS.updateAtomic.bind(UPLOADS), async getFresh(key) {
      const data = await UPLOADS.getFresh(key);
      return data ? new Upload(data) : undefined;
    } };
  };
  const requestModule = () => requests || require("../request");
  const assertLocal = (item, room) => {
    if (!item || item.roomid !== room.roomid || item.expires <= Date.now()) {
      throw Object.assign(new Error("The item is unavailable in this room. Refresh its report."), { status: 404, retryable: false });
    }
  };
  const audit = async (room, spec, operation, key) => {
    const state = auditStateFactory({ roomId: room.roomid, pluginId: spec.pluginId });
    const event = { operation, key, at: Date.now() };
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await state.get("audit:actions");
      try {
        await state.set("audit:actions", [...(previous?.value || []), event].slice(-50), { ifVersion: previous?.version || null }); break;
      }
      catch (error) {
        if (error.code !== "PLUGIN_STATE_CONFLICT" || attempt === 2) {
          throw error;
        }
      }
    }
    (broker || require("../broker")).emit("plugin:action", { roomid: room.roomid, pluginId: spec.pluginId, ...event });
  };
  return {
    ...require("./maintenance-api").createMaintenanceApi({ roomFor, fileMap, assertLocal, audit }),
    async listSessions(spec) {
      await roomFor(spec); return require("./sessions").getSessionService().list(spec.roomId);
    },
    async getRoomGuide(spec) {
      const room = await roomFor(spec);
      return { name: String(room.config.get("roomname") || "This room"), motd: String(room.config.get("rawmotd") || "").slice(0, 1000), allowRequests: room.config.get("allowRequests") !== false, ttlHours: Number(room.fileTTL) || 0 };
    },
    async claimRequest(spec) {
      const room = await roomFor(spec);
      const item = await requestModule().REQUESTS.getFresh(spec.key); assertLocal(item, room);
      const result = await requestModule().EMITTER.claim(spec.key, `plugin:${spec.pluginId}`, Math.min(3600000, Math.max(5000, Number(spec.ttlMs) || 300000)));
      await audit(room, spec, "request.claim", spec.key); return result.toClientJSON();
    },
    async releaseRequest(spec) {
      const room = await roomFor(spec);
      const item = await requestModule().REQUESTS.getFresh(spec.key); assertLocal(item, room);
      // Bots may release only their own claims. Stale human claims stay reviewable.
      const result = await requestModule().EMITTER.release(spec.key, `plugin:${spec.pluginId}`);
      await audit(room, spec, "request.release", spec.key); return result.toClientJSON();
    },
    async fulfillRequest(spec) {
      const room = await roomFor(spec);
      const file = await fileMap().getFresh(spec.fileKey); assertLocal(file, room);
      if (file.hidden) {
        throw conflict();
      }
      const { REQUESTS } = requestModule();
      const result = await REQUESTS.updateAtomic(spec.key, item => {
        assertLocal(item, room);
        if (revision(item.toClientJSON()) !== spec.expectedRevision || item.status !== "open") {
          throw conflict();
        }
        if (item.claimedBy && item.claimedBy !== `plugin:${spec.pluginId}` && item.claimedUntil > Date.now()) {
          throw Object.assign(new Error("This request has an active human claim. Ask the claimant to release it before fulfilling from this suggestion."), { status: 409 });
        }
        const data = { ...item.toJSON(), status: "fulfilled", fulfilledAt: Date.now(), fulfilledByNick: spec.botName, hints: { ...item.hints, fileKey: file.key, plugin: spec.pluginId } };
        return new item.constructor(data);
      });
      if (onRequestFulfilled) {
        await onRequestFulfilled(result);
      }
      else {
        require("../observability").trackRequestFulfilled(result);
      }
      await audit(room, spec, "request.fulfill", spec.key); return result.toClientJSON();
    },
    async curateFile(spec) {
      const room = await roomFor(spec);
      const result = await fileMap().updateAtomic(spec.key, file => {
        assertLocal(file, room);
        if (revision(file.toClientJSON()) !== spec.expectedRevision) {
          throw conflict();
        }
        const data = file.toJSON(); const previous = data.meta?.pluginCuration;
        if (spec.undo) {
          if (previous?.pluginId !== spec.pluginId || !previous.tags) {
            throw conflict();
          }
          data.tags = { ...data.tags };
          for (const [key, value] of Object.entries(previous.tags)) {
            if (data.tags[key] !== previous.applied[key]) {
              throw conflict();
            }
            if (value == null) {
              delete data.tags[key];
            }
            else {
              data.tags[key] = value;
            }
          }
          data.meta = { ...data.meta }; delete data.meta.pluginCuration;
        }
        else {
          const patch = {}; const before = {};
          for (const [key, value] of Object.entries(spec.tags || {})) {
            if (!["genre", "language", "series", "author", "collection"].includes(key) || typeof value !== "string" || !value.trim() || value.length > 200) {
              throw new Error("Choose supported short metadata values for curation.");
            }
            if (file.toClientJSON().tags?.[key]) {
              continue;
            }
            patch[key] = value.trim(); before[key] = data.tags?.[key] ?? null;
          }
          if (!Object.keys(patch).length) {
            throw conflict();
          }
          data.tags = { ...data.tags, ...patch }; data.meta = { ...data.meta, pluginCuration: { pluginId: spec.pluginId, at: Date.now(), tags: before, applied: patch } };
        }
        return new file.constructor(data);
      });
      await audit(room, spec, spec.undo ? "curation.undo" : "curation.apply", spec.key);
      return { key: result.key, revision: revision(result.toClientJSON()) };
    },
    async quarantineFile(spec) {
      const room = await roomFor(spec);
      const invitation = room.getRoomPlugins().find(plugin => plugin.id === spec.pluginId && plugin.enabled);
      if (spec.pluginId !== "upload-review" || invitation?.config.allowQuarantine !== true) {
        throw Object.assign(new Error("Quarantine requires the room owner's explicit Upload Review setting. Enable it before reviewing this action."), { status: 403 });
      }
      const result = await fileMap().updateAtomic(spec.key, file => {
        assertLocal(file, room);
        if (revision(file.toClientJSON()) !== spec.expectedRevision) {
          throw conflict();
        }
        const data = file.toJSON(); data.tags = { ...data.tags }; data.meta = { ...data.meta };
        if (spec.release) {
          if (data.meta.pluginQuarantine?.pluginId !== spec.pluginId) {
            throw conflict();
          }
          if (data.meta.pluginQuarantine.wasHidden) {
            data.tags.hidden = true;
          }
          else {
            delete data.tags.hidden;
          }
          delete data.meta.pluginQuarantine;
        }
        else {
          if (data.meta.pluginQuarantine) {
            throw conflict();
          }
          data.meta.pluginQuarantine = { pluginId: spec.pluginId, at: Date.now(), wasHidden: !!data.tags.hidden }; data.tags.hidden = true;
        }
        return new file.constructor(data);
      });
      await audit(room, spec, spec.release ? "quarantine.release" : "quarantine.apply", spec.key);
      return { key: result.key, revision: revision(result.toClientJSON()) };
    },
    async getAccessSummary(spec) {
      const room = await roomFor(spec);
      const invites = room.getGuestInvites();
      const now = Date.now(); const plugins = room.getRoomPlugins();
      const configured = require("../config").get("pluginConnections") || [];
      const factory = require("./connections").createPluginConnections();

      const connections = configured.filter(connection => connection.roomIds?.includes(room.roomid) || connection.roomIds?.includes("*")).map(connection => ({
        id: String(connection.id || "").slice(0, 64), provider: String(connection.provider || "").slice(0, 40),
        configured: factory({ roomId: room.roomid, pluginId: connection.pluginIds?.[0] }).list().find(item => item.id === connection.id)?.configured === true,
        allRooms: connection.roomIds.includes("*"), usedByInvitedBots: plugins.some(plugin => plugin.enabled && plugin.config?.connectionId === connection.id),
      }));

      const active = invite => (invite.expiresAt == null || invite.expiresAt > now) && invite.uses < invite.maxUses;
      return { activeInvites: invites.filter(active).length, expiredInvites: invites.filter(invite => !active(invite)).length,
        unusedInvites: invites.filter(invite => !invite.uses && invite.createdAt < now - 30 * 86400000).length,
        enabledBots: plugins.filter(plugin => plugin.enabled).length, disabledBots: plugins.filter(plugin => !plugin.enabled).length,
        connections,
        inviteOnly: room.config.get("inviteOnly") === true, privateLinking: room.config.get("allowPrivateLinking") === true };
    },
  };
}

module.exports = { createWorkflowApi, revision, conflict };
