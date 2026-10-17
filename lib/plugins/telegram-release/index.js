"use strict";

const crypto = require("crypto");
const {
  deliverReleaseOnce,
  resolveBaseUrl,
  absoluteUrl,
  truncate,
  buildDigest,
} = require("../release-notifier");
const {
  COMMANDS,
  normalizeAllowedCommands,
  normalizeRemoteIds,
  parseInboundCommand,
  executeInboundCommand,
} = require("../inbound-commands");

const PLUGIN_ID = "telegram-release";
const DEFAULT_BOT_NAME = "Hobbyfiles Releases";

const configSchema = {
  type: "object",
  required: ["roomId", "chatId"],
  properties: {
    roomId: {
      type: "string",
      description: "Hobbyfiles room id (set automatically for room invitations)",
    },
    botToken: {
      type: "string",
      format: "password",
      writeOnly: true,
      description:
        "Telegram BotFather token (or use HOBBYFILES_TELEGRAM_BOT_TOKEN)",
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
        "Public Hobbyfiles URL, for example https://files.example.org",
    },
    ignoreBotUploads: {
      type: "boolean",
      description: "Do not announce releases uploaded by another bot",
    },
    notifyRequests: { type: "boolean", description: "Also announce new and fulfilled community requests" },
    botUsername: { type: "string", description: "Optional Telegram bot username, without @, to accept commands addressed to this bot in groups" },
    inboundEnabled: {
      type: "boolean",
      description: "Accept authenticated Telegram commands for this room",
    },
    inboundWebhookSecret: {
      type: "string",
      format: "password",
      writeOnly: true,
      description:
        "Secret sent by Telegram in X-Telegram-Bot-Api-Secret-Token",
    },
    inboundCommands: {
      type: "array",
      items: { type: "string", enum: COMMANDS },
      description:
        "Explicit command allowlist: help, status, files, find, expiring, requests, request, say",
    },
    allowedInboundUserIds: {
      type: "array",
      items: { type: "string" },
      description: "Telegram numeric user IDs allowed to run commands",
    },
  },
};

function resolveBotToken(config) {
  return String(
    config && config.botToken ||
    process.env.HOBBYFILES_TELEGRAM_BOT_TOKEN ||
    "",
  ).trim();
}

function validateBotToken(token) {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(token || ""));
}

function resolveInboundWebhookSecret(config) {
  return String(
    config && config.inboundWebhookSecret ||
    process.env.HOBBYFILES_TELEGRAM_WEBHOOK_SECRET ||
    "",
  ).trim();
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
  if (c.botUsername && !/^[A-Za-z0-9_]{5,32}$/.test(c.botUsername)) {
    errors.push("botUsername must be a Telegram username without @");
  }
  if (!token) {
    errors.push(
      "botToken is required (or set HOBBYFILES_TELEGRAM_BOT_TOKEN)",
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
  if (c.inboundEnabled === true) {
    const secret = resolveInboundWebhookSecret(c);
    if (
      secret.length < 16 ||
      secret.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(secret)
    ) {
      errors.push(
        "inboundWebhookSecret must be 16-256 letters, numbers, _ or -",
      );
    }
    if (!normalizeAllowedCommands(c.inboundCommands).length) {
      errors.push("inboundCommands must enable at least one safe command");
    }
    if (!normalizeRemoteIds(c.allowedInboundUserIds).length) {
      errors.push(
        "inbound commands require at least one allowed Telegram user ID",
      );
    }
  }
  return { ok: !errors.length, errors };
}

function inboundError(message, status) {
  return Object.assign(new Error(message), { status });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function telegramCaller(message) {
  const from = message && message.from || {};
  return {
    id: String(from.id || ""),
    username: String(
      from.username ||
      [from.first_name, from.last_name].filter(Boolean).join(" ") ||
      "Telegram member",
    ),
  };
}

async function handleInbound(request, ctx) {
  const config = ctx && ctx.config || {};
  if (config.inboundEnabled !== true) {
    throw inboundError("Telegram inbound commands are disabled", 404);
  }
  const headers = request && request.headers || {};
  if (
    !safeEqual(
      headers["x-telegram-bot-api-secret-token"],
      resolveInboundWebhookSecret(config),
    )
  ) {
    throw inboundError("Telegram webhook secret rejected", 401);
  }
  const update = request.body || {};
  const {message} = update;
  if (!message || !message.text || update.update_id == null) {
    return { status: 200, body: { ok: true } };
  }
  if (message.from?.is_bot || !/^\s*\/[a-z]/i.test(message.text)) {
    return { status: 200, body: { ok: true } };
  }
  const addressed = message.text.trim().match(/^\/\w+@([A-Za-z0-9_]+)/);
  if (addressed && addressed[1].toLowerCase() !== String(config.botUsername || "").toLowerCase()) {
    return { status: 200, body: { ok: true } };
  }
  if (String(message.chat && message.chat.id || "") !== String(config.chatId)) {
    throw inboundError("Telegram chat is not allowed", 403);
  }
  if (
    config.messageThreadId != null &&
    Number(message.message_thread_id) !== Number(config.messageThreadId)
  ) {
    throw inboundError("Telegram topic is not allowed", 403);
  }
  const caller = telegramCaller(message);
  if (!normalizeRemoteIds(config.allowedInboundUserIds).includes(caller.id)) {
    throw inboundError("Telegram caller is not allowed", 403);
  }
  const lease = ctx.events && await ctx.events.begin(
    `telegram-inbound:${config.roomId}`,
    String(update.update_id),
    { leaseSeconds: 120 },
  );
  if (ctx.events && !lease) {
    return { status: 200, body: { ok: true } };
  }
  let response;
  try {
    const parsed = parseInboundCommand(message.text);
    response = await executeInboundCommand(ctx, {
      command: parsed.command,
      argument: parsed.argument,
      remoteUserId: caller.id,
      remoteUsername: caller.username,
    });
  }
  catch (error) {
    response = { text: error.message || "Command failed" };
  }
  finally {
    if (lease && typeof ctx.events.complete === "function") {
      await Promise.resolve(ctx.events.complete(lease)).catch(() => {});
    }
  }
  const body = {
    method: "sendMessage",
    chat_id: message.chat.id,
    text: truncate(response.text, 4000),
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  };
  if (message.message_thread_id != null) {
    body.message_thread_id = message.message_thread_id;
  }
  return { status: 200, body };
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
      release.isRequest ? release.fulfilled ? "Request fulfilled" : "New community request" : "New Hobbyfiles release",
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
    const status = Number(response.body.error_code) || 400;
    throw Object.assign(new Error(`Telegram rejected the message (code ${status}). Check the bot credentials, chat permissions and destination, then retry.`), { status, retryable: status === 429 || status >= 500, retryAfterMs: (Number(response.body.parameters?.retry_after) || 0) * 1000 });
  }
  return response;
}

function onEvent(event, payload, ctx) {
  return deliverReleaseOnce(ctx, event, payload, release => {
    const body = {
      chat_id: String(ctx.config.chatId),
      text: releaseMessage(release),
      link_preview_options: { is_disabled: false },
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open in Hobbyfiles", url: release.fileUrl }],
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
  const queued = await require("../release-notifier").publisherJob(ctx, args);
  if (queued.queued) {
    return queued.queued;
  }
  if (queued.event) {
    return queued.payload ? onEvent(queued.event, queued.payload, ctx) : { ok: true, skipped: true, reason: "item_unavailable" };
  }
  if (args && args.payload && args.event) {
    return onEvent(args.event, args.payload, ctx);
  }
  if (args?.mode === "digest") {
    const digest = await buildDigest(ctx);
    await postTelegram(ctx, { chat_id: String(ctx.config.chatId), text: digest.text, link_preview_options: { is_disabled: true }, ...(ctx.config.messageThreadId ? { message_thread_id: Number(ctx.config.messageThreadId) } : {}) });
    return { ok: true, delivered: 1, files: digest.count };
  }
  const baseUrl = resolveBaseUrl(ctx, ctx.config || {});
  const roomId = String(ctx.config && ctx.config.roomId || "");
  const body = {
    chat_id: String(ctx.config.chatId),
    text:
      "Hobbyfiles notifications connected.\n" +
      "New releases added to this room will be published here.",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Hobbyfiles room",
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
  version: "1.2.0",
  runModes: ["test", "digest"],
  description:
    "Publish every new room release to a Telegram chat, channel, or forum topic.",
  capabilities: [
    "events:read",
    "rooms:read",
    "rooms:write",
    "requests:read",
    "requests:write",
    "files:read",
    "network:write",
    "inbound:commands",
  ],
  eventSubscriptions: ["file_uploaded", "linked_file_appeared", "request_created", "request_fulfilled"],
  configSchema,
  validateConfig,
  hooks: { onEvent },
  inbound: { handle: handleInbound },
  run,
  _test: {
    resolveBotToken,
    validateBotToken,
    telegramEndpoint,
    releaseMessage,
    postTelegram,
    resolveInboundWebhookSecret,
    safeEqual,
    telegramCaller,
    handleInbound,
  },
};
