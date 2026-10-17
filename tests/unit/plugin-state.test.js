"use strict";

const { createPluginStateFactory } = require("../../lib/plugins/state");
const { createHobbyfilesPluginApi, createPluginHttpClient } = require("../../lib/plugins/runtime-adapters");
const { scopedPluginApi, scopedUpload } = require("../../lib/plugins/scoped-api");
const { createMegaDownloader } = require("../../lib/plugins/mega-folder/downloader");
const { guardPluginRun } = require("../../lib/plugins/run-guard");
const { createMemoryEventLease } = require("../../lib/plugins/event-lease");
const { PluginRegistry } = require("../../lib/plugins/registry");
const { defaultPluginConfig } = require("../../common/plugin-config");

test("state isolates plugin/room namespaces, versions, JSON values and expiry", async () => {
  let now = 1000; const create = createPluginStateFactory({ memory: true, now: () => now });
  const state = create({ pluginId: "collector", roomId: "room1" });
  const first = await state.set("cursor", { token: "next" }, { ifVersion: null, ttlSeconds: 60 });
  expect(first).toMatchObject({ value: { token: "next" }, updatedAt: 1000, expiresAt: 61000 });
  expect(await state.get("cursor")).toEqual(first);
  await expect(state.set("cursor", "overwrite", { ifVersion: null })).rejects.toMatchObject({ code: "PLUGIN_STATE_CONFLICT" });
  const second = await state.set("cursor", null, { ifVersion: first.version, ttlSeconds: 60 });
  expect(second.value).toBeNull(); expect(second.version).not.toBe(first.version);
  await expect(state.delete("cursor", { ifVersion: first.version })).rejects.toMatchObject({ status: 409 });
  expect(await create({ pluginId: "collector", roomId: "room2" }).get("cursor")).toBeNull();
  expect(await create({ pluginId: "reviewer", roomId: "room1" }).get("cursor")).toBeNull();
  now = 61001; expect(await state.get("cursor")).toBeNull();
  expect(await state.delete("cursor")).toBe(false);
});

test("state has stable bounded key-only pages and enforces capacity and JSON limits", async () => {
  const state = createPluginStateFactory({ memory: true })({ pluginId: "example" });
  for (const key of ["sync:c", "sync:a", "sync:b", "other"]) {
    await state.set(key, [1, 2]);
  }
  const page = await state.list({ prefix: "sync:", limit: 2 });
  expect(page.entries.map(entry => entry.key)).toEqual(["sync:a", "sync:b"]);
  expect(page.entries[0].value).toBeUndefined();
  expect((await state.list({ prefix: "sync:", cursor: page.nextCursor })).entries.map(entry => entry.key)).toEqual(["sync:c"]);
  expect(await state.delete("other")).toBe(true);
  await expect(state.set("../escape", true)).rejects.toThrow("keys");
  await expect(state.set("too-big", "x".repeat(16384))).rejects.toThrow("16 KiB");
  await expect(state.set("bad", undefined)).rejects.toThrow("JSON");
  await expect(state.set("bad", 1n)).rejects.toThrow("JSON");
  await expect(state.set("bad", 1, { ttlSeconds: 0 })).rejects.toThrow("retention");
  let deep = {}; for (let i = 0; i < 18; i++) {
    deep = { deep };
  }
  await expect(state.set("bad", deep)).rejects.toThrow("levels");
  for (let i = 0; i < 253; i++) {
    await state.set(`key${i}`, i);
  }
  await expect(state.set("overflow", true)).rejects.toMatchObject({ code: "PLUGIN_STATE_LIMIT" });
  expect((await state.set("key0", false)).value).toBe(false);
});

test("production state uses the atomic Redis namespace operation", async () => {
  const redis = { pluginstate: jest.fn(async () => JSON.stringify({ row: null })) };
  const state = createPluginStateFactory({ memory: false, redis })({ pluginId: "example", roomId: "room" });
  expect(await state.get("cursor")).toBeNull();
  expect(redis.pluginstate).toHaveBeenCalledWith(expect.stringMatching(/^plugin:state:[a-f0-9]{64}$/), "get", "cursor", "{}");
});

test("inventory and individual file reads stay in the invited room and redact legacy source keys", async () => {
  const files = [
    { key: "one", name: "one.pdf", size: 10, type: "pdf", hash: "same", expires: Date.now() + 10000, meta: { megaFolder: "https://mega.nz/folder/id#secret" } },
    { key: "two", name: "two.pdf", size: 10, type: "pdf", hash: "same" },
    { key: "request", meta: { request: true } },
  ];
  const api = scopedPluginApi(createHobbyfilesPluginApi({ getRoom: async id => id === "room" ? { files: { for: async () => files } } : null }), { roomId: "room", pluginId: "example" });
  expect(await api.getRoomInventory()).toMatchObject({ files: 2, bytes: 20, byType: { pdf: { files: 2, bytes: 20 } }, duplicateGroups: 1, duplicateCopies: 1, expiringWithin24Hours: 1 });
  expect((await api.getFile({ key: "one" })).meta.megaFolder).toBeUndefined();
  await expect(api.getFile({ key: "foreign" })).rejects.toMatchObject({ status: 404 });
  await expect(api.getFile({ key: "request" })).rejects.toMatchObject({ status: 404 });
  expect(() => api.getRoomInventory({ roomId: "other" })).toThrow("invited room");
});

test("bot upload identity cannot be overwritten by a plugin spec", async () => {
  const upload = jest.fn(async spec => spec);
  const scoped = scopedUpload(upload, "room", { pluginId: "example", botName: "Example Bot" });
  const result = await scoped({ role: "white", botName: "Human", meta: { plugin: "other", bot: false } });
  expect(result).toMatchObject({ roomId: "room", role: "bot", botName: "Example Bot", meta: { plugin: "example", bot: true, botName: "Example Bot" } });
});

test("bounded HTTP supports feeds and small binary metadata without JSON conversion", async () => {
  const client = createPluginHttpClient({ fetchImpl: async () => new Response(Buffer.from([0, 255, 128, 65])) });
  expect((await client.requestBuffer("https://example.org/file")).body).toEqual(Buffer.from([0, 255, 128, 65]));
  const feeds = createPluginHttpClient({ fetchImpl: async () => new Response("<feed />") });
  expect((await feeds.requestText("https://example.org/feed")).body).toBe("<feed />");
  await expect(feeds.requestJson("https://example.org/feed")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("Mega account uses authenticated SDK API and closes sessions on failure or completion", async () => {
  const api = {}; const close = jest.fn(); const options = [];
  const File = { fromURL: jest.fn(() => ({ children: [{ name: "one", size: 1 }], loadAttributes: async () => {} })) };

  class Storage {
    constructor(config) {
      options.push(config); this.api = api; this.ready = Promise.resolve(); this.close = close;
    }
  }

  const downloader = createMegaDownloader({ megajs: { File, Storage } });
  const entries = await downloader.listFolder("https://mega.nz/folder/example#key", { email: "example@example.org" });
  expect(options[0]).toMatchObject({ autoload: false, keepalive: false, fetch: expect.any(Function) });
  expect(File.fromURL).toHaveBeenCalledWith(expect.any(String), { api });
  expect(close).not.toHaveBeenCalled(); await entries.close(); expect(close).toHaveBeenCalledTimes(1);
  File.fromURL.mockImplementationOnce(() => {
    throw new Error("failure");
  });
  await expect(downloader.listFolder("https://mega.nz/folder/example#key", { email: "example@example.org" })).rejects.toThrow("failure");
  expect(close).toHaveBeenCalledTimes(2);
});

test("run guard renews owned leases and cancels adapters after ownership is lost", async () => {
  const events = createMemoryEventLease(); const lease = events.begin("example", "event");
  const upload = jest.fn(async () => ({})); const ctx = { events, uploadFile: upload };
  const guard = guardPluginRun(ctx, [lease]);
  try {
    await guard.assertOwned(); expect(ctx.signal.aborted).toBe(false);
    events.fail(lease);
    await expect(guard.assertOwned()).rejects.toThrow("ownership");
    expect(ctx.signal.aborted).toBe(true);
    expect(() => ctx.uploadFile({})).toThrow("ownership");
    expect(upload).not.toHaveBeenCalled();
  }
  finally {
    guard.stop();
  }
});

test("one failed global startup hook does not prevent other plugins from starting", async () => {
  const registry = new PluginRegistry(); const start = jest.fn(); const error = jest.fn();
  registry.register({ id: "broken", name: "Broken", hooks: { onStart() {
    throw new Error("token private");
  } } }, { token: "private" });
  registry.register({ id: "working", name: "Working", hooks: { onStart: start } });
  await registry.startAll({ log: { error } });
  expect(registry.get("broken").enabled).toBe(false); expect(start).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(error.mock.calls)).not.toContain("private");
});

test("new importer invitations have valid limits and manual-only polling", () => {
  const mega = require("../../lib/plugins/mega-folder"); const remote = require("../../lib/plugins/remote-import");

  for (const plugin of [mega, remote]) {
    const config = { ...defaultPluginConfig(plugin.configSchema), roomId: "room1234", folderUrl: "https://mega.nz/folder/example#key", urls: ["https://pixeldrain.com/u/example"] };
    expect(config).toMatchObject({ maxFilesPerRun: 50, maxBytesPerFile: 268435456, maxBytesPerRun: 1073741824, pollIntervalMinutes: 0 });
    expect(plugin.validateConfig(config)).toMatchObject({ ok: true });
  }
});

test("publisher form defaults keep Discord responses private and Telegram topic blank", () => {
  const discord = require("../../lib/plugins/discord-release"); const telegram = require("../../lib/plugins/telegram-release");

  expect(defaultPluginConfig(discord.configSchema).discordEphemeralResponses).toBe(true);
  expect(defaultPluginConfig(telegram.configSchema).messageThreadId).toBe("");
  const schema = { properties: { values: { type: "array", default: ["one"] } } };
  const values = defaultPluginConfig(schema); values.values.push("two");
  expect(schema.properties.values.default).toEqual(["one"]);
});
