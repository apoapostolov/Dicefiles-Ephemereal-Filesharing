"use strict";

const { normalizePluginId } = require("./plugin-id");
const { loadPluginModule } = require("./registry");
const { getPluginJobs } = require("./jobs");
const { createPluginConnections } = require("./connections");
const { createPluginStateFactory } = require("./state");
const { publicReport } = require("./reports");

let states;

function pluginScope(room, pluginId, enabled = false) {
  const id = normalizePluginId(pluginId);
  const entry = room.getRoomPlugins().find(item => item.id === id);
  if (!entry || !loadPluginModule(id).ok) {
    throw Object.assign(new Error("Invite an installed bot into this room first."), { status: 404 });
  }
  if (enabled && !entry.enabled) {
    throw Object.assign(new Error("Enable this bot before queuing or replaying work."), { status: 409 });
  }
  return { roomId: room.roomid, pluginId: id, config: { ...entry.config, roomId: room.roomid } };
}

async function pluginOperations(room, pluginId, options) {
  const scope = pluginScope(room, pluginId);
  states ||= createPluginStateFactory();
  const [page, report, audit] = await Promise.all([getPluginJobs().scope(scope).list(options), states(scope).get("report:last"), states(scope).get("audit:actions")]);
  return { ok: true, ...page, report: publicReport(report?.value), audit: (audit?.value || []).slice(-20).reverse(), connections: createPluginConnections()(scope).list() };
}

async function pluginJobAction(room, pluginId, action, input = {}) {
  const scope = pluginScope(room, pluginId, action !== "cancel");
  const jobs = getPluginJobs().scope(scope);
  if (action === "enqueue") {
    const {plugin} = loadPluginModule(scope.pluginId);
    if (input.mode && !(plugin.runModes || ["run"]).includes(input.mode)) {
      throw Object.assign(new Error("Choose one of this bot's supported run modes."), { status: 400 });
    }
    return { ok: true, job: await jobs.enqueue({ mode: input.mode, idempotencyKey: input.idempotencyKey }) };
  }
  if (!["cancel", "replay"].includes(action)) {
    throw Object.assign(new Error("Choose Cancel or Replay for an existing job."), { status: 400 });
  }
  return { ok: true, ...await jobs[action](input.id) };
}

function roomConnections(room, pluginId) {
  const id = normalizePluginId(pluginId);
  if (!id || !loadPluginModule(id).ok) {
    throw Object.assign(new Error("Choose an installed bot to list its connections."), { status: 404 });
  }
  return createPluginConnections()({ roomId: room.roomid, pluginId: id }).list();
}

async function pluginReportAction(room, pluginId, input) {
  const scope = pluginScope(room, pluginId, true);
  if (typeof input?.reportId !== "string" || input.reportId.length > 64 || typeof input.itemId !== "string" || input.itemId.length > 80 || !/^[a-z][a-z0-9-]{0,31}$/.test(input.action || "")) {
    throw Object.assign(new Error("Choose a valid action from the latest bot report."), { status: 400 });
  }
  const result = await require("./room-runtime").defaultRoomPluginRuntime.runRoomPlugin(room.roomid, scope.pluginId, { reason: "review", review: { reportId: input.reportId, itemId: input.itemId, action: input.action } }, room.getRoomPlugins());
  if (result?.skipped) {
    throw Object.assign(new Error("This bot is already running. Wait for it to finish, refresh activity and retry this review action."), { status: 409 });
  }
  return result;
}

module.exports = { pluginScope, pluginOperations, pluginJobAction, roomConnections, pluginReportAction };
