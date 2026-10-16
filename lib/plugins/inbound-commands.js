"use strict";

const COMMANDS = Object.freeze([
  "help",
  "status",
  "requests",
  "request",
  "say",
  "files",
  "find",
  "expiring",
]);

function normalizeAllowedCommands(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const allowed = new Set(COMMANDS);
  return Array.from(
    new Set(
      raw.
        map(value => String(value || "").trim().toLowerCase()).
        filter(value => allowed.has(value)),
    ),
  );
}

function normalizeRemoteIds(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw.
        map(value => String(value || "").trim()).
        filter(Boolean).
        slice(0, 100),
    ),
  );
}

function parseInboundCommand(text) {
  let value = String(text || "").trim();
  value = value.replace(/^\/+/, "");
  value = value.replace(/^dicefiles(?:@\S+)?\s+/i, "");
  const firstSpace = value.search(/\s/);
  const command = (
    firstSpace < 0 ? value : value.slice(0, firstSpace)
  ).toLowerCase().replace(/@\S+$/, "");
  const argument =
    firstSpace < 0 ? "" : value.slice(firstSpace + 1).trim();
  return { command, argument };
}

function requireCommandText(command, argument) {
  if (!argument) {
    throw new Error(`${command} requires text`);
  }
  const limit = command === "say" ? 1900 : 200;
  if (argument.length > limit) {
    throw new Error(`${command} text must be at most ${limit} characters`);
  }
  return argument;
}

async function executeInboundCommand(ctx, input) {
  const config = ctx && ctx.config || {};
  const allowed = normalizeAllowedCommands(config.inboundCommands);
  const command = String(input && input.command || "").toLowerCase();
  const argument = String(input && input.argument || "").trim();
  if (!allowed.includes(command)) {
    throw new Error("command is not enabled for this room");
  }
  if (!ctx || !ctx.dicefiles) {
    throw new Error("Dicefiles plugin API is unavailable");
  }
  const api = ctx.dicefiles;
  const roomId = String(config.roomId || "");
  const remoteUser =
    String(input && input.remoteUsername || "remote member").
      trim().
      slice(0, 80);

  if (command === "help") {
    return {
      command,
      text: `Available commands: ${allowed.join(", ")}`,
    };
  }
  if (command === "status") {
    const summary = await api.getRoomSummary(roomId);
    return {
      command,
      text:
        `${summary.name}: ${summary.files} files, ` +
        `${summary.openRequests} open requests.`,
    };
  }
  if (command === "requests") {
    const requests = await api.listRequests({
      roomId,
      status: "open",
      limit: 8,
    });
    return {
      command,
      text: requests.length ?
        `Open requests:\n${requests.map(request =>
          `• ${request.name}`).join("\n")}` :
        "There are no open requests.",
    };
  }
  if (["files", "find", "expiring"].includes(command)) {
    const { absoluteUrl, resolveBaseUrl, formatBytes, truncate } = require("./release-notifier");

    const query = command === "find" ? requireCommandText(command, argument) : "";
    const files = await api.listFiles({ roomId, query, limit: 6, expiresBefore: command === "expiring" ? Date.now() + 86400000 : undefined });
    const base = resolveBaseUrl(ctx, config);
    const heading = command === "find" ? "Matching files" : command === "expiring" ? "Files expiring within 24 hours" : "Recent files";
    return { command, text: files.length ? `${heading}:\n${files.map(file => `• ${truncate(file.name, 100)} · ${formatBytes(file.size)}\n${absoluteUrl(base, file.href)}`).join("\n")}` : command === "find" ? "No files match that name. Try a shorter filename." : "No files to show." };
  }
  if (command === "request") {
    const text = requireCommandText(command, argument);
    const request = await api.createRequest({
      roomId,
      text,
      botName: ctx.botName,
      pluginId: ctx.pluginId,
      remoteUser,
    });
    return {
      command,
      text: `Request added: ${request.name || text}`,
    };
  }
  if (command === "say") {
    const text = requireCommandText(command, argument);
    await api.postMessage({
      roomId,
      text: `${remoteUser}: ${text}`,
      botName: ctx.botName,
      pluginId: ctx.pluginId,
    });
    return {
      command,
      text: "Message posted to the Dicefiles room.",
    };
  }
  throw new Error("unsupported command");
}

module.exports = {
  COMMANDS,
  normalizeAllowedCommands,
  normalizeRemoteIds,
  parseInboundCommand,
  executeInboundCommand,
};
