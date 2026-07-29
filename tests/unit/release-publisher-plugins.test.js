"use strict";

const crypto = require("crypto");
const path = require("path");
const discord = require("../../lib/plugins/discord-release");
const telegram = require("../../lib/plugins/telegram-release");
const {
  createMemoryEventLease,
  createRedisEventLease,
} = require("../../lib/plugins/event-lease");
const {
  createPluginHttpClient,
  createDicefilesPluginApi,
} = require("../../lib/plugins/runtime-adapters");
const {
  buildRelease,
  deliverWithRetry,
  formatBytes,
} = require("../../lib/plugins/release-notifier");
const {
  createRoomPluginRuntime,
} = require("../../lib/plugins/room-runtime");

const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz";
const TELEGRAM_BOT_TOKEN = "123456:abcdefghijklmnopqrstuvwxyz_ABCDE";

function uploadPayload(overrides) {
  return Object.assign(
    {
      key: "release-key",
      roomid: "room1234",
      name: "Adventure Pack.pdf",
      href: "/g/release-key/Adventure%20Pack.pdf",
      size: 2 * 1024 * 1024,
      uploaded: Date.parse("2026-07-28T10:00:00.000Z"),
      type: "document/application/pdf",
      meta: {},
    },
    overrides || {},
  );
}

function baseCtx(pluginId, config, calls) {
  return {
    pluginId,
    botName: "Dicefiles Releases",
    publicBaseUrl: "https://files.example.test",
    config: Object.assign({ roomId: "room1234" }, config),
    events: createMemoryEventLease(),
    dicefiles: {
      async getRoomSummary() {
        return {
          roomId: "room1234",
          name: "New Releases",
        };
      },
    },
    http: {
      async requestJson(url, options) {
        calls.push({ url, options });
        return { ok: true, status: 200, body: { ok: true, id: "m1" } };
      },
    },
  };
}

describe("release notifier contract", () => {
  test("builds absolute, room-enriched release data", async () => {
    const release = await buildRelease(
      baseCtx("test", {}, []),
      "file_uploaded",
      uploadPayload(),
    );
    expect(release.roomName).toBe("New Releases");
    expect(release.fileUrl).toBe(
      "https://files.example.test/g/release-key/Adventure%20Pack.pdf",
    );
    expect(release.roomUrl).toBe(
      "https://files.example.test/r/room1234",
    );
    expect(release.sizeLabel).toBe("2.0 MiB");
    expect(formatBytes(1024)).toBe("1.0 KiB");
  });

  test("ignores another room and optionally bot uploads", async () => {
    const ctx = baseCtx(
      "test",
      { ignoreBotUploads: true },
      [],
    );
    await expect(
      buildRelease(ctx, "file_uploaded", uploadPayload({ roomid: "other" })),
    ).resolves.toBeNull();
    await expect(
      buildRelease(
        ctx,
        "file_uploaded",
        uploadPayload({ meta: { bot: true } }),
      ),
    ).resolves.toBeNull();
  });

  test("retries transient remote delivery", async () => {
    let attempts = 0;
    const result = await deliverWithRetry(
      { deliveryRetryBaseMs: 0 },
      { key: "k1" },
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("temporary");
        }
        return "sent";
      },
    );
    expect(result).toBe("sent");
    expect(attempts).toBe(3);
  });
});

describe("Discord release publisher", () => {
  test("validates official webhook URLs", () => {
    expect(
      discord.validateConfig({
        roomId: "room1234",
        webhookUrl: DISCORD_WEBHOOK_URL,
      }).ok,
    ).toBe(true);
    expect(
      discord.validateConfig({
        roomId: "room1234",
        webhookUrl: "https://example.test/api/webhooks/1/token",
      }).ok,
    ).toBe(false);
  });

  test("publishes one safe embed and deduplicates repeat delivery", async () => {
    const calls = [];
    const ctx = baseCtx(
      discord.id,
      { webhookUrl: DISCORD_WEBHOOK_URL },
      calls,
    );
    const first = await discord.hooks.onEvent(
      "file_uploaded",
      uploadPayload(),
      ctx,
    );
    const second = await discord.hooks.onEvent(
      "file_uploaded",
      uploadPayload(),
      ctx,
    );
    expect(first.skipped).toBe(false);
    expect(second.reason).toBe("already_delivered");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("wait=true");
    expect(calls[0].options.body.allowed_mentions).toEqual({ parse: [] });
    expect(calls[0].options.body.embeds[0]).toMatchObject({
      title: "Adventure Pack.pdf",
      url:
        "https://files.example.test/g/release-key/Adventure%20Pack.pdf",
    });
  });

  test("verifies and executes an allowlisted Discord interaction", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" });
    const publicKeyHex = Buffer.from(publicJwk.x, "base64url").toString("hex");
    const interaction = {
      id: "interaction-1",
      type: 2,
      data: {
        name: "dicefiles",
        options: [{ name: "status", type: 1 }],
      },
      member: {
        user: { id: "user-1", username: "Alice" },
        roles: [],
      },
    };
    const rawBody = Buffer.from(JSON.stringify(interaction));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.sign(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      privateKey,
    ).toString("hex");
    const ctx = baseCtx(
      discord.id,
      {
        webhookUrl: DISCORD_WEBHOOK_URL,
        inboundEnabled: true,
        applicationPublicKey: publicKeyHex,
        inboundCommands: ["status"],
        allowedInboundUserIds: ["user-1"],
      },
      [],
    );
    ctx.dicefiles.getRoomSummary = async () => ({
      name: "Release Room",
      files: 12,
      openRequests: 3,
    });
    const response = await discord.inbound.handle(
      {
        headers: {
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        rawBody,
        body: interaction,
      },
      ctx,
    );
    expect(response.body.type).toBe(4);
    expect(response.body.data.content).toContain(
      "12 files, 3 open requests",
    );

    await expect(
      discord.inbound.handle(
        {
          headers: {
            "x-signature-ed25519": "0".repeat(128),
            "x-signature-timestamp": timestamp,
          },
          rawBody,
          body: interaction,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("Telegram release publisher", () => {
  test("validates token, chat, and topic id", () => {
    expect(
      telegram.validateConfig({
        roomId: "room1234",
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: "-100123456789",
        messageThreadId: 42,
      }).ok,
    ).toBe(true);
    expect(
      telegram.validateConfig({
        roomId: "room1234",
        botToken: "bad",
        chatId: "",
      }).ok,
    ).toBe(false);
  });

  test("publishes a release with an open-file button", async () => {
    const calls = [];
    const ctx = baseCtx(
      telegram.id,
      {
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: "-100123456789",
        messageThreadId: 42,
      },
      calls,
    );
    const result = await telegram.hooks.onEvent(
      "linked_file_appeared",
      uploadPayload({ sourceRoomName: "Source Library" }),
      ctx,
    );
    expect(result.skipped).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/sendMessage");
    expect(calls[0].options.body).toMatchObject({
      chat_id: "-100123456789",
      message_thread_id: 42,
    });
    expect(
      calls[0].options.body.reply_markup.inline_keyboard[0][0].url,
    ).toContain("/g/release-key/");
    expect(calls[0].options.body.text).toContain(
      "Linked from Source Library",
    );
  });

  test("authenticates Telegram updates and creates allowlisted requests", async () => {
    const created = [];
    const ctx = baseCtx(
      telegram.id,
      {
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: "-100123456789",
        inboundEnabled: true,
        inboundWebhookSecret: "secure_webhook_secret_123",
        inboundCommands: ["request"],
        allowedInboundUserIds: ["42"],
      },
      [],
    );
    ctx.dicefiles.createRequest = async (spec) => {
      created.push(spec);
      return { name: spec.text };
    };
    const response = await telegram.inbound.handle(
      {
        headers: {
          "x-telegram-bot-api-secret-token":
            "secure_webhook_secret_123",
        },
        body: {
          update_id: 99,
          message: {
            message_id: 8,
            text: "/request Pathfinder maps",
            chat: { id: -100123456789 },
            from: { id: 42, username: "alice" },
          },
        },
      },
      ctx,
    );
    expect(created[0]).toMatchObject({
      roomId: "room1234",
      text: "Pathfinder maps",
      remoteUser: "alice",
    });
    expect(response.body).toMatchObject({
      method: "sendMessage",
      chat_id: -100123456789,
    });
    expect(response.body.text).toContain("Request added");
  });
});

describe("bot runtime extensions", () => {
  test("Redis event leases allow retry after failure and suppress completion", async () => {
    const values = new Map();
    const redis = {
      async get(key) {
        return values.get(key) || null;
      },
      async set(key, value, ...args) {
        if (args.includes("NX") && values.has(key)) {
          return null;
        }
        values.set(key, value);
        return "OK";
      },
      async del(key) {
        return values.delete(key) ? 1 : 0;
      },
    };
    const leases = createRedisEventLease(redis);
    const first = await leases.begin("discord:room", "file:k1");
    expect(first).toBeTruthy();
    expect(await leases.begin("discord:room", "file:k1")).toBeNull();
    await leases.fail(first);
    const retry = await leases.begin("discord:room", "file:k1");
    expect(retry).toBeTruthy();
    await leases.complete(retry);
    expect(await leases.begin("discord:room", "file:k1")).toBeNull();
  });

  test("HTTP client sends JSON without exposing URL in errors", async () => {
    const client = createPluginHttpClient({
      async fetchImpl(_url, options) {
        expect(options.headers["content-type"]).toBe("application/json");
        return {
          ok: false,
          status: 401,
          async text() {
            return JSON.stringify({ message: "unauthorized" });
          },
        };
      },
    });
    await expect(
      client.requestJson("https://example.test/secret-token", {
        method: "POST",
        body: { hello: "world" },
      }),
    ).rejects.toThrow("HTTP 401: unauthorized");
    try {
      await client.requestJson("https://example.test/secret-token", {
        method: "POST",
        body: { hello: "world" },
      });
    } catch (ex) {
      expect(ex.message).not.toContain("secret-token");
    }
  });

  test("Dicefiles plugin API returns stable room and file objects", async () => {
    const api = createDicefilesPluginApi({
      async listRoomRequests() {
        return [];
      },
      async getRoom() {
        return {
          fileTTL: 48,
          config: { get: () => "Release Room" },
          files: {
            async for() {
              return [
                {
                  key: "k1",
                  name: "one.zip",
                  uploaded: 20,
                  tags: {},
                  meta: {},
                },
                {
                  key: "k0",
                  name: "old.zip",
                  uploaded: 10,
                  tags: {},
                  meta: {},
                },
              ];
            },
          },
        };
      },
    });
    await expect(api.getRoomSummary("room1234")).resolves.toMatchObject({
      roomId: "room1234",
      name: "Release Room",
      fileTTL: 48,
    });
    await expect(
      api.listFiles({ roomId: "room1234", since: 15 }),
    ).resolves.toEqual([
      expect.objectContaining({ key: "k1", name: "one.zip" }),
    ]);
  });

  test("room runtime fans subscribed events to invited publishers", async () => {
    const calls = [];
    const events = createMemoryEventLease();
    const runtime = createRoomPluginRuntime({
      loadModule: (id) =>
        require("../../lib/plugins/registry").loadPluginModule(id, {
          pluginsRoot: path.join(__dirname, "../../lib/plugins"),
        }),
      buildCtx: () => ({
        publicBaseUrl: "https://files.example.test",
        events,
        dicefiles: {
          async getRoomSummary() {
            return { roomId: "room1234", name: "Release Room" };
          },
        },
        http: {
          async requestJson(url, options) {
            calls.push({ url, options });
            return { ok: true, status: 200, body: { id: "m1" } };
          },
        },
      }),
      log: { info() {}, warn() {}, error() {} },
    });
    await runtime.emitEventToRoom(
      "file_uploaded",
      uploadPayload(),
      "room1234",
      [
        {
          id: "discord-release",
          enabled: true,
          config: { webhookUrl: DISCORD_WEBHOOK_URL },
        },
      ],
    );
    expect(calls).toHaveLength(1);
  });

  test("room catalog exposes both release publishers and their contracts", () => {
    const runtime = createRoomPluginRuntime({
      loadModule: (id) =>
        require("../../lib/plugins/registry").loadPluginModule(id, {
          pluginsRoot: path.join(__dirname, "../../lib/plugins"),
        }),
      log: { info() {}, warn() {}, error() {} },
    });
    const catalog = runtime.listCatalog();
    for (const id of ["discord-release", "telegram-release"]) {
      expect(catalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id,
            available: true,
            capabilities: expect.arrayContaining(["network:write"]),
            eventSubscriptions: expect.arrayContaining(["file_uploaded"]),
          }),
        ]),
      );
    }
  });
});
