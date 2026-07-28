"use strict";

const {
  deliverReleaseOnce,
  resolveBaseUrl,
  absoluteUrl,
  truncate,
} = require("../release-notifier");

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
  },
};

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
  return { ok: !errors.length, errors };
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
  version: "1.0.0",
  description:
    "Publish every new room release to a Discord channel using an incoming webhook.",
  capabilities: ["events:read", "rooms:read", "network:write"],
  eventSubscriptions: ["file_uploaded", "linked_file_appeared"],
  configSchema,
  validateConfig,
  hooks: { onEvent },
  run,
  _test: {
    resolveWebhookUrl,
    validateWebhookUrl,
    discordEndpoint,
    releaseEmbed,
    postDiscord,
  },
};
