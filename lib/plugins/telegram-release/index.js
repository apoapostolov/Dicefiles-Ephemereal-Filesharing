"use strict";

const {
  deliverReleaseOnce,
  resolveBaseUrl,
  absoluteUrl,
  truncate,
} = require("../release-notifier");

const PLUGIN_ID = "telegram-release";
const DEFAULT_BOT_NAME = "Dicefiles Releases";

const configSchema = {
  type: "object",
  required: ["roomId", "chatId"],
  properties: {
    roomId: {
      type: "string",
      description: "Dicefiles room id (set automatically for room invitations)",
    },
    botToken: {
      type: "string",
      format: "password",
      writeOnly: true,
      description:
        "Telegram BotFather token (or use DICEFILES_TELEGRAM_BOT_TOKEN)",
    },
    chatId: {
      type: "string",
      description: "Telegram group, channel, or private chat id",
    },
    messageThreadId: {
      type: "number",
      description: "Optional Telegram forum topic id",
    },
    baseUrl: {
      type: "string",
      description:
        "Public Dicefiles URL, for example https://files.example.org",
    },
    ignoreBotUploads: {
      type: "boolean",
      description: "Do not announce releases uploaded by another bot",
    },
  },
};

function resolveBotToken(config) {
  return String(
    config && config.botToken ||
    process.env.DICEFILES_TELEGRAM_BOT_TOKEN ||
    "",
  ).trim();
}

function validateBotToken(token) {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(token || ""));
}

function validateConfig(config) {
  const errors = [];
  const c = config || {};
  if (!c.roomId || String(c.roomId).length < 4) {
    errors.push("roomId is required");
  }
  if (!c.chatId || !String(c.chatId).trim()) {
    errors.push("chatId is required");
  }
  const token = resolveBotToken(c);
  if (!token) {
    errors.push(
      "botToken is required (or set DICEFILES_TELEGRAM_BOT_TOKEN)",
    );
  }
  else if (!validateBotToken(token)) {
    errors.push("botToken is not a valid Telegram bot token");
  }
  if (c.messageThreadId != null) {
    const threadId = Number(c.messageThreadId);
    if (!Number.isInteger(threadId) || threadId <= 0) {
      errors.push("messageThreadId must be a positive integer");
    }
  }
  if (c.baseUrl) {
    try {
      require("../release-notifier").normalizeBaseUrl(c.baseUrl);
    }
    catch (ex) {
      errors.push(ex.message);
    }
  }
  return { ok: !errors.length, errors };
}

function telegramEndpoint(config) {
  return `https://api.telegram.org/bot${resolveBotToken(config)}/sendMessage`;
}

function releaseMessage(release) {
  const origin =
    release.isLinked && release.sourceRoomName ?
      `Linked from ${release.sourceRoomName}` :
      `Added to ${release.roomName}`;
  return truncate(
    [
      "New Dicefiles release",
      "",
      release.fileName,
      `${release.sizeLabel} · ${release.type}`,
      origin,
      "",
      release.fileUrl,
    ].join("\n"),
    4096,
  );
}

async function postTelegram(ctx, payload) {
  if (!ctx || !ctx.http || typeof ctx.http.requestJson !== "function") {
    throw new Error("telegram-release requires ctx.http.requestJson");
  }
  const response = await ctx.http.requestJson(
    telegramEndpoint(ctx.config || {}),
    {
      method: "POST",
      timeoutMs: 10000,
      body: payload,
      sensitiveUrl: true,
    },
  );
  if (response && response.body && response.body.ok === false) {
    throw new Error(
      `Telegram rejected the message: ${response.body.description || "unknown error"}`,
    );
  }
  return response;
}

function onEvent(event, payload, ctx) {
  return deliverReleaseOnce(ctx, event, payload, release => {
    const body = {
      chat_id: String(ctx.config.chatId),
      text: releaseMessage(release),
      disable_web_page_preview: false,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open in Dicefiles", url: release.fileUrl }],
        ],
      },
    };
    if (ctx.config.messageThreadId != null) {
      body.message_thread_id = Number(ctx.config.messageThreadId);
    }
    return postTelegram(ctx, body);
  });
}

async function run(ctx, args) {
  if (args && args.payload && args.event) {
    return onEvent(args.event, args.payload, ctx);
  }
  const baseUrl = resolveBaseUrl(ctx, ctx.config || {});
  const roomId = String(ctx.config && ctx.config.roomId || "");
  const body = {
    chat_id: String(ctx.config.chatId),
    text:
      "Dicefiles notifications connected.\n" +
      "New releases added to this room will be published here.",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Dicefiles room",
            url: absoluteUrl(baseUrl, `/r/${encodeURIComponent(roomId)}`),
          },
        ],
      ],
    },
  };
  if (ctx.config.messageThreadId != null) {
    body.message_thread_id = Number(ctx.config.messageThreadId);
  }
  await postTelegram(ctx, body);
  return { ok: true, delivered: 1, test: true };
}

module.exports = {
  id: PLUGIN_ID,
  name: "Telegram Release Publisher",
  botName: DEFAULT_BOT_NAME,
  version: "1.0.0",
  description:
    "Publish every new room release to a Telegram chat, channel, or forum topic.",
  capabilities: ["events:read", "rooms:read", "network:write"],
  eventSubscriptions: ["file_uploaded", "linked_file_appeared"],
  configSchema,
  validateConfig,
  hooks: { onEvent },
  run,
  _test: {
    resolveBotToken,
    validateBotToken,
    telegramEndpoint,
    releaseMessage,
    postTelegram,
  },
};
