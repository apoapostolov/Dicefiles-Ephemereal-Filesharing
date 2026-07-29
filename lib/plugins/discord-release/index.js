"use strict";

const crypto = require("crypto");
const {
  deliverReleaseOnce,
  resolveBaseUrl,
  absoluteUrl,
  truncate,
} = require("../release-notifier");
const {
  COMMANDS,
  normalizeAllowedCommands,
  normalizeRemoteIds,
  executeInboundCommand,
} = require("../inbound-commands");

const PLUGIN_ID = "discord-release";
const DEFAULT_BOT_NAME = "Dicefiles Releases";

const configSchema = {
  type: "object",
  required: ["roomId"],
  properties: {
    roomId: {
      type: "string",
      description: "Dicefiles room id (set automatically for room invitations)",
    },
    webhookUrl: {
      type: "string",
      format: "password",
      writeOnly: true,
      description:
        "Discord incoming webhook URL (or use DICEFILES_DISCORD_WEBHOOK_URL)",
    },
    baseUrl: {
      type: "string",
      description:
        "Public Dicefiles URL, for example https://files.example.org",
    },
    botName: {
      type: "string",
      description: "Discord webhook display name",
    },
    avatarUrl: {
      type: "string",
      description: "Optional HTTPS avatar URL",
    },
    threadId: {
      type: "string",
      description: "Optional Discord forum/thread id",
    },
    ignoreBotUploads: {
      type: "boolean",
      description: "Do not announce releases uploaded by another bot",
    },
    inboundEnabled: {
      type: "boolean",
      description: "Accept signed Discord slash commands for this room",
    },
    applicationPublicKey: {
      type: "string",
      format: "password",
      writeOnly: true,
      description:
        "Discord application public key used to verify interactions",
    },
    inboundCommands: {
      type: "array",
      items: { type: "string", enum: COMMANDS },
      description:
        "Explicit command allowlist: help, status, requests, request, say",
    },
    allowedInboundUserIds: {
      type: "array",
      items: { type: "string" },
      description: "Discord user IDs allowed to run inbound commands",
    },
    allowedInboundRoleIds: {
      type: "array",
      items: { type: "string" },
      description: "Discord role IDs allowed to run inbound commands",
    },
    discordEphemeralResponses: {
      type: "boolean",
      description: "Keep slash-command responses visible only to the caller",
    },
  },
};

function resolveApplicationPublicKey(config) {
  return String(
    config && config.applicationPublicKey ||
    process.env.DICEFILES_DISCORD_APPLICATION_PUBLIC_KEY ||
    "",
  ).trim();
}

function resolveWebhookUrl(config) {
  return String(
    config && config.webhookUrl ||
    process.env.DICEFILES_DISCORD_WEBHOOK_URL ||
    "",
  ).trim();
}

function validateWebhookUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (host === "discord.com" ||
        host.endsWith(".discord.com") ||
        host === "discordapp.com" ||
        host.endsWith(".discordapp.com")) &&
      /\/api\/webhooks\/[^/]+\/[^/]+/.test(parsed.pathname)
    );
  }
  catch (_) {
    return false;
  }
}

function validateConfig(config) {
  const errors = [];
  const c = config || {};
  if (!c.roomId || String(c.roomId).length < 4) {
    errors.push("roomId is required");
  }
  const webhookUrl = resolveWebhookUrl(c);
  if (!webhookUrl) {
    errors.push(
      "webhookUrl is required (or set DICEFILES_DISCORD_WEBHOOK_URL)",
    );
  }
  else if (!validateWebhookUrl(webhookUrl)) {
    errors.push("webhookUrl must be an official Discord incoming webhook URL");
  }
  if (c.baseUrl) {
    try {
      require("../release-notifier").normalizeBaseUrl(c.baseUrl);
    }
    catch (ex) {
      errors.push(ex.message);
    }
  }
  if (c.avatarUrl) {
    try {
      const avatar = new URL(c.avatarUrl);
      if (avatar.protocol !== "https:") {
        errors.push("avatarUrl must use https");
      }
    }
    catch (_) {
      errors.push("avatarUrl must be a valid URL");
    }
  }
  if (c.inboundEnabled === true) {
    if (!/^[a-f0-9]{64}$/i.test(resolveApplicationPublicKey(c))) {
      errors.push(
        "applicationPublicKey must be the 64-character Discord public key",
      );
    }
    if (!normalizeAllowedCommands(c.inboundCommands).length) {
      errors.push("inboundCommands must enable at least one safe command");
    }
    if (
      !normalizeRemoteIds(c.allowedInboundUserIds).length &&
      !normalizeRemoteIds(c.allowedInboundRoleIds).length
    ) {
      errors.push(
        "inbound commands require an allowed Discord user or role ID",
      );
    }
  }
  return { ok: !errors.length, errors };
}

function inboundError(message, status) {
  return Object.assign(new Error(message), { status });
}

function discordPublicKey(publicKeyHex) {
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function verifyDiscordInteraction(request, config, now) {
  const headers = request && request.headers || {};
  const signature = String(headers["x-signature-ed25519"] || "");
  const timestamp = String(headers["x-signature-timestamp"] || "");
  const rawBody = request && request.rawBody;
  const publicKey = resolveApplicationPublicKey(config);
  if (
    !Buffer.isBuffer(rawBody) ||
    !/^[a-f0-9]{128}$/i.test(signature) ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(publicKey)
  ) {
    return false;
  }
  const timestampMs = Number(timestamp) * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs((Number(now) || Date.now()) - timestampMs) > 5 * 60 * 1000
  ) {
    return false;
  }
  return crypto.verify(
    null,
    Buffer.concat([Buffer.from(timestamp), rawBody]),
    discordPublicKey(publicKey),
    Buffer.from(signature, "hex"),
  );
}

function discordCommand(interaction) {
  const data = interaction && interaction.data || {};
  const options = Array.isArray(data.options) ? data.options : [];
  let command = String(data.name || "").toLowerCase();
  let commandOptions = options;
  if (command === "dicefiles") {
    const subcommand = options.find((option) => option && option.type === 1);
    if (subcommand) {
      command = String(subcommand.name || "").toLowerCase();
      commandOptions = Array.isArray(subcommand.options)
        ? subcommand.options
        : [];
    }
    else {
      const commandOption = options.find(
        (option) => option && ["command", "action"].includes(option.name),
      );
      command = String(commandOption && commandOption.value || "")
        .toLowerCase();
    }
  }
  const argumentOption = commandOptions.find(
    (option) =>
      option &&
      ["text", "message", "request", "query"].includes(option.name),
  );
  return {
    command,
    argument: String(argumentOption && argumentOption.value || ""),
  };
}

function discordCaller(interaction) {
  const member = interaction && interaction.member || {};
  const user = member.user || interaction && interaction.user || {};
  return {
    id: String(user.id || ""),
    username: String(
      member.nick || user.global_name || user.username || "Discord member",
    ),
    roles: normalizeRemoteIds(member.roles),
  };
}

function discordCallerAllowed(config, caller) {
  const users = normalizeRemoteIds(config.allowedInboundUserIds);
  const roles = new Set(normalizeRemoteIds(config.allowedInboundRoleIds));
  return (
    users.includes(caller.id) ||
    caller.roles.some((role) => roles.has(role))
  );
}

async function handleInbound(request, ctx) {
  const config = ctx && ctx.config || {};
  if (config.inboundEnabled !== true) {
    throw inboundError("Discord inbound commands are disabled", 404);
  }
  if (!verifyDiscordInteraction(request, config)) {
    throw inboundError("Discord signature rejected", 401);
  }
  const interaction = request.body || {};
  if (interaction.type === 1) {
    return { status: 200, body: { type: 1 } };
  }
  if (interaction.type !== 2 || !interaction.id) {
    throw inboundError("Unsupported Discord interaction", 400);
  }
  const caller = discordCaller(interaction);
  if (!discordCallerAllowed(config, caller)) {
    throw inboundError("Discord caller is not allowed", 403);
  }
  const lease = ctx.events && await ctx.events.begin(
    `discord-inbound:${config.roomId}`,
    String(interaction.id),
    { leaseSeconds: 120 },
  );
  if (ctx.events && !lease) {
    return {
      status: 200,
      body: {
        type: 4,
        data: { content: "This command was already processed.", flags: 64 },
      },
    };
  }
  let response;
  try {
    const parsed = discordCommand(interaction);
    response = await executeInboundCommand(ctx, {
      command: parsed.command,
      argument: parsed.argument,
      remoteUserId: caller.id,
      remoteUsername: caller.username,
    });
    if (lease && typeof ctx.events.complete === "function") {
      await ctx.events.complete(lease);
    }
  }
  catch (error) {
    if (lease && typeof ctx.events.complete === "function") {
      await Promise.resolve(ctx.events.complete(lease)).catch(() => {});
    }
    response = { text: error.message || "Command failed" };
  }
  return {
    status: 200,
    body: {
      type: 4,
      data: {
        content: truncate(response.text, 1900),
        flags: config.discordEphemeralResponses === false ? 0 : 64,
        allowed_mentions: { parse: [] },
      },
    },
  };
}

function discordEndpoint(config) {
  const parsed = new URL(resolveWebhookUrl(config));
  parsed.searchParams.set("wait", "true");
  if (config && config.threadId) {
    parsed.searchParams.set("thread_id", String(config.threadId));
  }
  return parsed.toString();
}

function releaseEmbed(release) {
  const origin =
    release.isLinked && release.sourceRoomName ?
      `Linked from ${release.sourceRoomName}` :
      `Added to ${release.roomName}`;
  return {
    title: truncate(release.fileName, 256),
    url: release.fileUrl,
    description: origin,
    color: 0x7c8cff,
    fields: [
      { name: "Size", value: release.sizeLabel, inline: true },
      {
        name: "Type",
        value: truncate(release.type || "file", 1024),
        inline: true,
      },
    ],
    timestamp: release.uploadedAt,
    footer: { text: "Dicefiles release notification" },
  };
}

function postDiscord(ctx, payload) {
  if (!ctx || !ctx.http || typeof ctx.http.requestJson !== "function") {
    throw new Error("discord-release requires ctx.http.requestJson");
  }
  return ctx.http.requestJson(discordEndpoint(ctx.config || {}), {
    method: "POST",
    timeoutMs: 10000,
    body: payload,
    sensitiveUrl: true,
  });
}

function onEvent(event, payload, ctx) {
  return deliverReleaseOnce(ctx, event, payload, release =>
    postDiscord(ctx, {
      username:
        String(ctx.config && ctx.config.botName || ctx.botName || DEFAULT_BOT_NAME).
          trim().
          slice(0, 80),
      avatar_url:
        ctx.config && ctx.config.avatarUrl ?
          String(ctx.config.avatarUrl) :
          undefined,
      allowed_mentions: { parse: [] },
      embeds: [releaseEmbed(release)],
    }),
  );
}

async function run(ctx, args) {
  if (args && args.payload && args.event) {
    return onEvent(args.event, args.payload, ctx);
  }
  const baseUrl = resolveBaseUrl(ctx, ctx.config || {});
  const roomId = String(ctx.config && ctx.config.roomId || "");
  await postDiscord(ctx, {
    username:
      String(ctx.config && ctx.config.botName || ctx.botName || DEFAULT_BOT_NAME).
        trim().
        slice(0, 80),
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Dicefiles notifications connected",
        url: absoluteUrl(baseUrl, `/r/${encodeURIComponent(roomId)}`),
        description:
          "New releases added to this room will be published here.",
        color: 0x7c8cff,
      },
    ],
  });
  return { ok: true, delivered: 1, test: true };
}

module.exports = {
  id: PLUGIN_ID,
  name: "Discord Release Publisher",
  botName: DEFAULT_BOT_NAME,
  version: "1.1.0",
  description:
    "Publish every new room release to a Discord channel using an incoming webhook.",
  capabilities: [
    "events:read",
    "rooms:read",
    "rooms:write",
    "requests:read",
    "requests:write",
    "network:write",
    "inbound:commands",
  ],
  eventSubscriptions: ["file_uploaded", "linked_file_appeared"],
  configSchema,
  validateConfig,
  hooks: { onEvent },
  inbound: { handle: handleInbound },
  run,
  _test: {
    resolveWebhookUrl,
    validateWebhookUrl,
    discordEndpoint,
    releaseEmbed,
    postDiscord,
    resolveApplicationPublicKey,
    verifyDiscordInteraction,
    discordCommand,
    discordCaller,
    discordCallerAllowed,
    handleInbound,
  },
};
