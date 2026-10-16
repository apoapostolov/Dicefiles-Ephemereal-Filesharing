"use strict";

function scopedPluginApi(api, { roomId, pluginId, botName }) {
  if (!api || typeof api !== "object") {
    return api;
  }
  const scoped = Object.assign({}, api);
  const scopedRoom = requested => {
    if (roomId && requested && String(requested) !== String(roomId)) {
      throw new Error("This bot can only access its invited room. Invite it separately in the other room.");
    }
    return requested || roomId;
  };
  if (typeof api.getRoomSummary === "function") {
    scoped.getRoomSummary = requested => api.getRoomSummary(scopedRoom(requested));
  }
  for (const method of ["inspectFile", "verifyFile", "retryFilePreview", "getStorageMetrics", "probeLink", "inspectBackup", "verifyBackup", "retryFileMetadata", "listSessions", "getRoomGuide", "claimRequest", "releaseRequest", "fulfillRequest", "curateFile", "quarantineFile", "getAccessSummary", "listLinks", "addLink", "getEventItem", "getFile", "getRoomInventory", "listFiles", "listFilesPage", "listRequests", "createRequest", "postMessage"]) {
    if (typeof api[method] === "function") {
      scoped[method] = spec => api[method](Object.assign({}, spec, { roomId: scopedRoom(spec?.roomId), botName, pluginId }));
    }
  }
  return scoped;
}

function scopedUpload(upload, roomId, identity = {}) {
  if (typeof upload !== "function") {
    return upload;
  }
  return spec => {
    if (roomId && spec?.roomId && String(spec.roomId) !== String(roomId)) {
      throw new Error("This bot can only upload into its invited room.");
    }
    return upload(Object.assign({}, spec, { roomId: roomId || spec?.roomId }, identity.pluginId ? {
      botName: identity.botName, role: "bot", meta: Object.assign({}, spec?.meta, { plugin: identity.pluginId, bot: true, botName: identity.botName }),
    } : {}));
  };
}

module.exports = { scopedPluginApi, scopedUpload };
