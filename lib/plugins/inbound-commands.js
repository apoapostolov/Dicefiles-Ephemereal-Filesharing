"use strict";

const COMMANDS = Object.freeze([
  "help",
  "status",
  "requests",
  "request",
  "say",
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
  if (argument.length > 200) {
    throw new Error(`${command} text must be at most 200 characters`);
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
