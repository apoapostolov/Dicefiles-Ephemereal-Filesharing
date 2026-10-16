"use strict";

const { Readable } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PluginRegistry, resolvePluginModulePath, normalizePluginConfigs } = require("../../lib/plugins/registry");
const { createRoomPluginRuntime } = require("../../lib/plugins/room-runtime");
const { createMemoryEventLease, createRedisEventLease } = require("../../lib/plugins/event-lease");
const { createMemorySyncLog } = require("../../lib/plugins/sync-log");
const { createMemoryRunStatusStore } = require("../../lib/plugins/run-status");
const { createPluginHttpClient, createDicefilesPluginApi, createUploadFileAdapter } = require("../../lib/plugins/runtime-adapters");
const { redactPluginConfig, upsertRoomPlugin, runRoomPlugin } = require("../../lib/http/room-automation");
const { scopedPluginApi, scopedUpload } = require("../../lib/plugins/scoped-api");
const { publicMetadata, sourceFingerprint } = require("../../lib/plugins/metadata");
const { RemoteDownloaderRegistry } = require("../../lib/plugins/remote-downloaders");
const mega = require("../../lib/plugins/mega-folder");
const remote = require("../../lib/plugins/remote-import");
const discord = require("../../lib/plugins/discord-release");
const telegram = require("../../lib/plugins/telegram-release");
const { executeInboundCommand } = require("../../lib/plugins/inbound-commands");
const { buildRelease, deliverWithRetry } = require("../../lib/plugins/release-notifier");

const log = { info() {}, warn() {}, error() {} };
const invitations = [{ id: "example", enabled: true, config: {} }];
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function runtime(plugin, base = {}) {
  return createRoomPluginRuntime({ loadModule: () => ({ ok: true, plugin: { id: "example", name: "Example", ...plugin } }), buildCtx: () => base, runStatus: createMemoryRunStatusStore(), log });
}

test("plugin IDs reject path traversal and Mega aliases normalize consistently", () => {
  for (const id of ["../example", "C:/example", "foo\\bar", "foo/bar", "__proto__"]) {
    expect(resolvePluginModulePath(id)).toBeNull();
  }
  expect(normalizePluginConfigs([{ id: "mega" }, { id: "mega.nz" }]).map(entry => entry.id)).toEqual(["mega-folder"]);
  expect(new PluginRegistry().loadFromConfig([{ id: "does-not-exist", enabled: false }])).toEqual({ loaded: [], errors: [] });
});

test("room event schedules retain invitations and stop after revocation", async () => {
  const calls = [];
  const rt = runtime({ eventSubscriptions: ["file_uploaded"], hooks: { onEvent(_event, payload, ctx) {
    ctx.scheduleRun("example", { reason: "file_uploaded", payload });
  } }, run: async ctx => calls.push(ctx.config.roomId) });
  await rt.emitEventToRoom("file_uploaded", { key: "synthetic" }, "room1234", invitations);
  await nextTurn();
  expect(calls).toEqual(["room1234"]);
  rt.clearRoom("room1234");
});

test("identical room sync does not recreate poll timers or startup scans", async () => {
  const run = jest.fn(async () => ({})); const rt = runtime({ run });
  const list = [{ ...invitations[0], config: { pollIntervalMinutes: 5 } }];
  rt.syncRoom("room1234", list); const timer = rt._timers.get("room1234::example");
  rt.syncRoom("room1234", list);
  expect(rt._timers.get("room1234::example")).toBe(timer);
  await nextTurn(); expect(run).toHaveBeenCalledTimes(1);
  rt.clearRoom("room1234");
});

test("pending scheduled work rechecks a revoked invitation", async () => {
  const run = jest.fn(); const rt = runtime({ run });
  rt.syncRoom("room1234", [{ ...invitations[0], config: { pollIntervalMinutes: 5 } }]);
  rt.clearRoom("room1234"); await nextTurn(); expect(run).not.toHaveBeenCalled();
});

test("manual runs cannot overlap across workers and become available again on completion", async () => {
  const events = createMemoryEventLease(); let finish;
  const run = jest.fn(() => new Promise(resolve => {
    finish = resolve;
  }));
  const rt = runtime({ run }, { events }); const other = runtime({ run }, { events });
  const first = rt.runRoomPlugin("room1234", "example", {}, invitations);
  await nextTurn();
  expect(await other.runRoomPlugin("room1234", "example", {}, invitations)).toMatchObject({ skipped: true, reason: "already_running" });
  finish({ uploaded: 1 }); await first;
  expect(events._locked.size).toBe(0);
});

test("disabled bots cannot be forced and run config cannot change the invited room", async () => {
  const run = jest.fn(async (ctx, args) => ({ roomId: ctx.config.roomId, override: args.config }));
  const rt = runtime({ run });
  await expect(rt.runRoomPlugin("room1234", "example", { force: true }, [{ ...invitations[0], enabled: false }])).rejects.toThrow("disabled");
  await expect(rt.runRoomPlugin("room1234", "example", { config: { roomId: "other" } }, invitations)).resolves.toMatchObject({ roomId: "room1234", override: undefined });
  await expect(rt.runRoomPlugin("room1234", "example", { config: {} }, [])).rejects.toThrow("not invited");
});

test("legacy events use the same leases as scheduled runs", async () => {
  const events = createMemoryEventLease(); const run = jest.fn(async () => ({ uploaded: 1 }));
  const rt = runtime({ run }, { events }); const list = [{ ...invitations[0], config: { pollEvents: ["file_uploaded"] } }];
  await rt.emitEventToRoom("file_uploaded", { key: "synthetic" }, "room1234", list);
  await rt.emitEventToRoom("file_uploaded", { key: "synthetic" }, "room1234", list);
  expect(run).toHaveBeenCalledTimes(1);
});

test("room adapters force bot attribution and reject cross-room reads and uploads", async () => {
  const createRequest = jest.fn(async spec => spec);
  const api = scopedPluginApi({ createRequest, listFiles: jest.fn() }, { roomId: "room1234", botName: "Collection Bot", pluginId: "example" });
  await expect(api.createRequest({ text: "Book", botName: "Human" })).resolves.toMatchObject({ roomId: "room1234", botName: "Collection Bot", pluginId: "example" });
  expect(() => api.listFiles({ roomId: "other" })).toThrow("invited room");
  expect(() => scopedUpload(jest.fn(), "room1234")({ roomId: "other" })).toThrow("invited room");
});

test("HTTP timeouts cover stalled response bodies", async () => {
  jest.useFakeTimers();
  try {
    const client = createPluginHttpClient({ fetchImpl: async (_url, options) => ({ ok: true, status: 200, text: () => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error(), { name: "AbortError" })))) }) });
    const check = expect(client.requestJson("https://example.test", { timeoutMs: 500 })).rejects.toMatchObject({ code: "REMOTE_NETWORK_ERROR" });
    await jest.advanceTimersByTimeAsync(501); await check;
  }
  finally {
    jest.useRealTimers();
  }
});

test("HTTP responses are bounded and errors never echo provider secrets", async () => {
  const tooLarge = createPluginHttpClient({ fetchImpl: async () => ({ ok: true, body: Readable.from([Buffer.alloc(2048)]) }) });
  await expect(tooLarge.requestJson("https://example.test", { maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", retryable: false });
  const client = createPluginHttpClient({ fetchImpl: async (_url, options) => {
    expect(options.redirect).toBe("error");
    return { status: 429, ok: false, headers: new Headers({ "retry-after": "4" }), text: async () => JSON.stringify({ message: "private_token_value", parameters: { retry_after: 6 } }) };
  } });
  await expect(client.requestJson("https://example.test/private_token_value")).rejects.toMatchObject({ retryAfterMs: 6000, retryable: true });
  await expect(client.requestJson("https://example.test/private_token_value")).rejects.not.toThrow("private_token_value");
});

test("long provider backoff is never retried early", async () => {
  const deliver = jest.fn(async () => {
    throw Object.assign(new Error("Rate limited"), { retryable: true, retryAfterMs: 90000 });
  });
  await expect(deliverWithRetry({ deliveryRetryBaseMs: 0 }, {}, deliver)).rejects.toThrow("Rate limited");
  expect(deliver).toHaveBeenCalledTimes(1);
});

test("buffer uploads honor the same byte limit as stream uploads", async () => {
  const ingest = jest.fn();
  const upload = createUploadFileAdapter({ getRoom: async () => ({}), ingestFromBuffer: ingest });
  await expect(upload({ roomId: "room1234", name: "large.bin", body: Buffer.alloc(5), maxBytes: 4 })).rejects.toMatchObject({ code: "PLUGIN_UPLOAD_TOO_LARGE" });
  expect(ingest).not.toHaveBeenCalled();
});

test("legacy Mega metadata exposes only a source fingerprint", () => {
  const source = "https://mega.nz/folder/synthetic#private_key"; const meta = { plugin: "mega-folder", megaFolder: source, sourceIdHash: "source" };
  expect(publicMetadata(meta)).toEqual({ plugin: "mega-folder", megaFolderHash: sourceFingerprint(source), sourceIdHash: "source" });
  expect(meta.megaFolder).toBe(source);
});

test("schema secrets and nested credentials are removed from plugin API responses", () => {
  const redacted = redactPluginConfig({ urls: ["https://mega.nz/folder/synthetic#key"], nested: { botToken: "secret", label: "safe" } }, { properties: { urls: { writeOnly: true } } });
  expect(redacted.config).toEqual({ nested: { label: "safe" } });
  expect(redacted.secretFields).toEqual(["urls"]);
});

test("Mega rejects host confusion and both importers validate filters and polling", () => {
  expect(mega.validateConfig({ roomId: "room1234", folderUrl: "https://evil.test/mega.nz" }).ok).toBe(false);
  for (const plugin of [mega, remote]) {
    expect(plugin.validateConfig({ roomId: "room1234", folderUrl: "https://mega.nz/folder/synthetic", urls: ["https://pixeldrain.com/u/synthetic"], includeExtensions: ["pdf"], pollIntervalMinutes: Infinity }).ok).toBe(false);
  }
});

test.each(["mega", "remote"])("%s import previews filter files without downloads, uploads or sync marks", async kind => {
  const download = jest.fn(async () => Buffer.from("data")); const uploadFile = jest.fn(); const syncLog = createMemorySyncLog(); const mark = jest.spyOn(syncLog, "mark");
  const entries = [{ name: "book.PDF", size: 4, sourceId: "one", download }, { name: "sample.pdf", size: 4, sourceId: "two", download }, { name: "movie.mp4", size: 4, sourceId: "three", download }];
  const config = { roomId: "room1234", folderUrl: "https://mega.nz/folder/synthetic#key", urls: ["https://pixeldrain.com/l/synthetic"], includeExtensions: ["pdf"], excludeNameContains: ["sample"] };
  const ctx = { config, syncLog, uploadFile, megaDownloader: { listFolder: async () => entries }, remoteDownloaders: { listFolder: async () => ({ provider: { id: "pixeldrain" }, entries }) } };
  const result = await (kind === "mega" ? mega : remote).run(ctx, { mode: "preview" });
  expect(result).toMatchObject({ dryRun: true, planned: 1, uploaded: 0, skippedByReason: { filtered: 2 } });
  expect(download).not.toHaveBeenCalled(); expect(uploadFile).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
});

test("disabled remote providers cannot resolve sources", () => {
  const providers = new RemoteDownloaderRegistry([{ id: "example", enabled: false, canHandle: () => true, listFolder: async () => [] }]);
  expect(() => providers.resolve("https://example.test")).toThrow("No enabled downloader");
});

test("file API pages tied timestamps without gaps and filters expiring files", async () => {
  const files = [{ key: "b", name: "Book.pdf", uploaded: 10, expires: Date.now() + 60000 }, { key: "a", name: "Atlas.pdf", uploaded: 10 }, { key: "c", name: "Movie.mp4", uploaded: 5 }];
  const api = createDicefilesPluginApi({ getRoom: async () => ({ files: { for: async () => files } }) });
  const first = await api.listFilesPage({ roomId: "room1234", limit: 1 });
  expect(first.files[0].key).toBe("a");
  const second = await api.listFilesPage({ roomId: "room1234", limit: 1, cursor: first.nextCursor }); expect(second.files[0].key).toBe("b");
  expect((await api.listFiles({ roomId: "room1234", query: "BOOK", expiresBefore: Date.now() + 86400000 })).map(file => file.key)).toEqual(["b"]);
});

test.each(["files", "find", "expiring"])("%s command uses bounded room file queries", async command => {
  const listFiles = jest.fn(async () => [{ name: "Book.pdf", size: 123, href: "/g/synthetic" }]);
  const result = await executeInboundCommand({ config: { roomId: "room1234", inboundCommands: [command] }, publicBaseUrl: "https://files.example.test", dicefiles: { listFiles } }, { command, argument: "Book" });
  expect(result.text).toContain("https://files.example.test/g/synthetic");
  expect(listFiles.mock.calls[0][0]).toMatchObject({ roomId: "room1234", limit: 6 });
});

test("request notifications are explicit opt-in", async () => {
  const ctx = { config: { roomId: "room1234" }, publicBaseUrl: "https://files.example.test" };
  const payload = { roomid: "room1234", key: "synthetic", text: "New map", href: "/q/synthetic" };
  expect(await buildRelease(ctx, "request_created", payload)).toBeNull();
  ctx.config.notifyRequests = true;
  await expect(buildRelease(ctx, "request_fulfilled", payload)).resolves.toMatchObject({ isRequest: true, fulfilled: true, fileName: "New map" });
});

test.each([discord, telegram])("$id digest publishes a bounded current file summary", async plugin => {
  const requestJson = jest.fn(async () => ({ ok: true, body: { ok: true } }));
  await plugin.run({ config: { roomId: "room1234", webhookUrl: "https://discord.com/api/webhooks/123456/synthetic", botToken: "123456:synthetic", chatId: "123456" }, publicBaseUrl: "https://files.example.test", http: { requestJson }, dicefiles: { listFiles: async () => [{ name: "Book.pdf", href: "/g/synthetic" }], getRoomSummary: async () => ({ name: "Community" }) } }, { mode: "digest" });
  expect(JSON.stringify(requestJson.mock.calls[0][1].body)).toContain("Book.pdf");
});

test("Telegram ignores ordinary chat, other bots and commands addressed elsewhere", async () => {
  const ctx = { config: { inboundEnabled: true, inboundWebhookSecret: "synthetic_secret_123", botUsername: "our_bot" } };
  for (const text of ["Hello everyone", "/status@other_bot"]) {
    await expect(telegram.inbound.handle({ headers: { "x-telegram-bot-api-secret-token": "synthetic_secret_123" }, body: { update_id: 1, message: { text } } }, ctx)).resolves.toEqual({ status: 200, body: { ok: true } });
  }
});

test("Discord supports official versioned webhooks and rejects credential-bearing URLs", () => {
  expect(discord._test.validateWebhookUrl("https://discord.com/api/v10/webhooks/123456/synthetic")).toBe(true);
  expect(discord._test.validateWebhookUrl("https://secret@discord.com/api/webhooks/123456/synthetic")).toBe(false);
});

test("slow Discord interactions defer before the deadline and edit the original response", async () => {
  let finish; const work = new Promise(resolve => {
    finish = resolve;
  });
  const requestJson = jest.fn(async () => ({}));
  const response = await discord._test.respondInTime({ application_id: "123456", token: "synthetic_interaction_token" }, { config: {}, http: { requestJson }, log }, () => work);
  expect(response.body).toEqual({ type: 5, data: { flags: 64 } });
  finish({ body: { data: { content: "Ready", flags: 64, allowed_mentions: { parse: [] } } } });
  await nextTurn(); await nextTurn();
  expect(requestJson).toHaveBeenCalledWith(expect.stringContaining("/messages/@original"), expect.objectContaining({ method: "PATCH", body: { content: "Ready", allowed_mentions: { parse: [] } } }));
});

test("Redis completion uses ownership-checked atomic commands", async () => {
  const redis = { get: jest.fn(async () => null), set: jest.fn(async () => "OK"), del: jest.fn(), lease: jest.fn(), eventcomplete: jest.fn() };
  const events = createRedisEventLease(redis); const lease = await events.begin("scope", "event");
  await events.complete(lease);
  expect(redis.eventcomplete).toHaveBeenCalledWith(lease.lockKey, lease.doneKey, lease.token, expect.any(Number));
  await events.fail(lease); expect(redis.lease).toHaveBeenCalledWith(lease.lockKey, lease.token, "release"); expect(redis.del).not.toHaveBeenCalled();
});

test("run API accepts preview and rejects disabled bots without running them", async () => {
  const runRoomPluginNow = jest.fn(async () => ({ planned: 2 }));
  const room = { roomid: "room1234", getRoomPlugins: () => [{ id: "mega-folder", enabled: true }], runRoomPluginNow };
  await runRoomPlugin(room, "mega-folder", { mode: "preview" });
  expect(runRoomPluginNow).toHaveBeenCalledWith("mega-folder", { mode: "preview" });
  room.getRoomPlugins = () => [{ id: "mega-folder", enabled: false }];
  await expect(runRoomPlugin(room, "mega-folder", {})).rejects.toMatchObject({ status: 409 });
});

test("partial plugin updates retain disabled state and credentials", () => {
  const inviteRoomPlugin = jest.fn(entry => [entry]);
  const room = { roomid: "room1234", getRoomPlugins: () => [{ id: "telegram-release", enabled: false, config: { botToken: "secret" } }], inviteRoomPlugin };
  upsertRoomPlugin(room, "telegram-release", { config: { chatId: "1234" } });
  expect(inviteRoomPlugin.mock.calls[0][0]).toMatchObject({ enabled: false, config: { botToken: "secret", chatId: "1234" } });
});

test("Mega aliases share one canonical run lease across room workers", async () => {
  const events = createMemoryEventLease(); let finish; let calls = 0;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const plugin = { id: "mega-folder", name: "Mega", async run() {
    if (++calls === 1) {
      await pending;
    } return { ok: true };
  } };
  const loadModule = jest.fn(() => ({ ok: true, plugin }));
  const create = () => createRoomPluginRuntime({ loadModule, buildCtx: () => ({ events }), log });
  const list = [{ id: "mega-folder", enabled: true, config: {} }];
  const first = create().runRoomPlugin("room1234", "mega", {}, list);
  try {
    await nextTurn();
    expect(await create().runRoomPlugin("room1234", "mega.nz", {}, list)).toMatchObject({ skipped: true, reason: "already_running" });
    expect(loadModule.mock.calls.every(([id]) => id === "mega-folder")).toBe(true);
    expect(calls).toBe(1);
  }
  finally {
    finish(); await first;
  }
});

test.each(["room", "global"])("%s runs normalize non-Error failures and release their active lease", async kind => {
  const events = createMemoryEventLease(); let fail = true;
  const plugin = { id: "example", name: "Example", run() {
    if (fail) {
      throw "Provider failed synthetic_secret_value";
    } return { ok: true };
  } };
  const config = { token: "synthetic_secret_value" };
  let run;
  if (kind === "room") {
    const rt = runtime(plugin, { events });
    run = () => rt.runRoomPlugin("room1234", "example", {}, [{ ...invitations[0], config }]);
  }
  else {
    const registry = new PluginRegistry(); registry.register(plugin, { ...config, roomId: "room1234" });
    await registry.startAll({ events, log }); run = () => registry.run("example");
  }
  await expect(run()).rejects.toThrow("Provider failed [redacted]");
  expect(events._locked.size).toBe(0);
  fail = false; await expect(run()).resolves.toEqual({ ok: true });
});

test("shared room updates preserve omitted settings and reject oversized merged configuration", () => {
  const update = require("../../lib/plugins/room-plugins").upsertRoomPlugin;

  const original = [{ id: "telegram-release", enabled: false, config: { botToken: "secret", chatId: "1234", namePrefix: "old", messageThreadId: 123 } }];
  const saved = update(original, { id: "telegram-release", config: { chatId: "5678", namePrefix: "", messageThreadId: null } })[0];
  expect(saved).toMatchObject({ enabled: false, config: { botToken: "secret", chatId: "5678", namePrefix: "", messageThreadId: null } });
  expect(original[0].config.chatId).toBe("1234");
  expect(() => update(original, { id: "telegram-release", enabled: "false" })).toThrow("true or false");
  expect(() => update([{ id: "example", config: { first: "x".repeat(4500) } }], { id: "example", config: { second: "y".repeat(4500) } })).toThrow("8000");
});

test("room form can clear optional settings while blank credentials remain omitted", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../client/roomie/optsdlg.js"), "utf8");
  const method = source.slice(source.indexOf("  readPluginEditorConfig() {"), source.indexOf("  validatePluginEditor() {")).replace("readPluginEditorConfig()", "function readPluginEditorConfig()");
  const read = vm.compileFunction(`${method}\nreturn readPluginEditorConfig;`)();
  const inputs = [
    { name: "plugin_cfg_messageThreadId", type: "number", value: "" },
    { name: "plugin_cfg_namePrefix", type: "text", value: "", dataset: {} },
    { name: "plugin_cfg_botToken", type: "password", value: "", dataset: {} },
    { name: "plugin_cfg_inboundCommands", type: "text", value: "", dataset: { configType: "array" } },
  ];
  expect(read.call({ plugineditorfields: { querySelectorAll: () => inputs } })).toEqual({ messageThreadId: null, namePrefix: "", inboundCommands: [] });
});

test.each(["error", "string", "null"])("room hooks redact %s failures before persisting run status", async kind => {
  const runStatus = createMemoryRunStatusStore();
  const plugin = { id: "example", name: "Example", eventSubscriptions: ["file_uploaded"], hooks: { onEvent() {
    if (kind === "error") {
      throw new Error("Provider failed synthetic_secret_value");
    }
    throw kind === "string" ? "Provider failed synthetic_secret_value" : null;
  } } };
  const rt = createRoomPluginRuntime({ loadModule: () => ({ ok: true, plugin }), buildCtx: () => ({}), runStatus, log });
  await rt.emitEventToRoom("file_uploaded", {}, "room1234", [{ ...invitations[0], config: { token: "synthetic_secret_value" } }]);
  const status = await runStatus.get("room1234", "example");
  expect(status.ok).toBe(false);
  expect(status.error).not.toContain("synthetic_secret_value");
  if (kind !== "null") {
    expect(status.error).toContain("Provider failed [redacted]");
  }
});
