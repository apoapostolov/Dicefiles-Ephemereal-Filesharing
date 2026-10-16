"use strict";

const { Readable } = require("node:stream");
const feed = require("../../lib/plugins/feed-collector");
const { defineCollector } = require("../../lib/plugins/collection/engine");
const { createPluginStateFactory } = require("../../lib/plugins/state");
const { createMemorySyncLog } = require("../../lib/plugins/sync-log");

function context(config = {}) {
  const files = []; const links = [];
  return {
    config: { roomId: "synthetic-room", ...config }, botName: "Collector", signal: new AbortController().signal,
    state: createPluginStateFactory({ memory: true })({ pluginId: "feed-collector", roomId: "synthetic-room" }), syncLog: createMemorySyncLog(),
    dicefiles: { listFilesPage: async () => ({ files }), addLink: jest.fn(async entry => {
      links.push(entry); return { added: true };
    }) },
    uploadFile: jest.fn(async spec => {
      for await (const _chunk of spec.body) { /* consume */ } const file = { key: `file${files.length}`, meta: spec.meta }; files.push(file); return file;
    }),
  };
}

const rss = "<rss><channel><item><guid>one</guid><title>Example</title><link>https://example.org/article</link><enclosure url=\"https://example.org/file.pdf\" length=\"4\" /></item></channel></rss>";

test("RSS and Atom normalize links/enclosures and reject entities, invalid XML and unapproved origins", () => {
  const net = { stream: jest.fn() };
  const entries = feed.parseFeed(rss, "https://example.org/feed", ["https://example.org"], true, net);
  expect(entries).toHaveLength(2); expect(entries[0]).toMatchObject({ id: "one", kind: "link", name: "Example" });
  expect(entries[1]).toMatchObject({ name: "file.pdf", size: 4 });
  entries[1].open(4); expect(net.stream).toHaveBeenCalledWith("https://example.org/file.pdf", {}, expect.objectContaining({ maxBytes: 4 }));
  const atom = "<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry><id>entry</id><title>News</title><link href=\"/article\" /></entry></feed>";
  expect(feed.parseFeed(atom, "https://example.org/feed", ["https://example.org"], false, net)[0].url).toBe("https://example.org/article");
  expect(() => feed.parseFeed("<!DOCTYPE rss [<!ENTITY a \"bad\">]><rss/>", "", [], false, net)).toThrow("entities");
  expect(() => feed.parseFeed("<rss>", "", [], false, net)).toThrow("invalid");
  expect(() => feed.parseFeed(rss, "https://example.org/feed", ["https://other.example"], true, net)).toThrow("approved origins");
});

test("feed preview is non-mutating, conditional polls and entry IDs survive repeat scans", async () => {
  const ctx = context({ feedUrl: "https://example.org/feed", allowedOrigins: ["https://example.org"] });
  ctx.collectionFetch = jest.fn(async () => new Response(rss, { headers: { etag: "\"version1\"" } }));
  const preview = await feed.run(ctx, { mode: "preview" });
  expect(preview.planned).toBe(1); expect(ctx.dicefiles.addLink).not.toHaveBeenCalled();
  expect((await ctx.state.list()).entries).toHaveLength(0);
  expect((await feed.run(ctx, { mode: "run" })).uploaded).toBe(1);
  expect((await feed.run(ctx, { mode: "run" })).skipped).toBe(1);
  expect(ctx.dicefiles.addLink).toHaveBeenCalledTimes(1);
  expect(ctx.collectionFetch.mock.calls[2][1].headers["if-none-match"]).toBe("\"version1\"");
  ctx.collectionFetch.mockResolvedValue(new Response(null, { status: 304 }));
  expect((await feed.run(ctx, { mode: "run" })).checked).toBe(0);
});

test("stream budgets, provenance dedupe and page checkpoints survive partial runs", async () => {
  const page = jest.fn(async () => ({ entries: ["one", "two"].map(id => ({ id, name: `${id}.pdf`, revision: "v1", size: 4, open: async () => Readable.from([Buffer.from("data")]) })), checkpoint: { cursor: "next" } }));
  const collector = defineCollector({ id: "synthetic", name: "Synthetic", provider: "test", properties: {}, page });
  const ctx = context({ maxFilesPerRun: 1 });
  expect((await collector.run(ctx, { mode: "run" })).uploaded).toBe(1);
  expect((await ctx.state.list()).entries).toHaveLength(0);
  expect((await collector.run(ctx, { mode: "run" })).uploaded).toBe(1);
  expect((await ctx.state.list()).entries).toHaveLength(1);
  // Even losing the dedupe log cannot create a duplicate while provenance exists.
  ctx.syncLog = createMemorySyncLog();
  expect((await collector.run(ctx, { mode: "run" })).uploaded).toBe(0);
  expect(ctx.uploadFile).toHaveBeenCalledTimes(2);
  ctx.config.maxBytesPerFile = 3;
  expect((await collector.run(ctx, { mode: "preview" })).planned).toBe(0);
});

test("connections are checked without ingest and Retry-After propagates to the job", async () => {
  const ctx = context({ feedUrl: "https://example.org/feed", allowedOrigins: ["https://example.org"] });
  ctx.collectionFetch = async () => new Response(rss);
  expect((await feed.run(ctx, { mode: "test" })).test).toBe(true);
  expect(ctx.dicefiles.addLink).not.toHaveBeenCalled();
  ctx.collectionFetch = async () => new Response("", { status: 429, headers: { "retry-after": "600" } });
  await expect(feed.run(ctx, { mode: "run" })).rejects.toMatchObject({ retryable: true, retryAfterMs: 600000 });
  ctx.config.feedUrl = "http://127.0.0.1/feed";
  await expect(feed.run(ctx, { mode: "run" })).rejects.toThrow("approved origins");
});

test("S3 grants the configured bucket/prefix and conditions object reads on the listed revision", async () => {
  const { page } = require("../../lib/plugins/s3-collection");

  const client = { send: jest.fn().mockResolvedValueOnce({ Contents: [{ Key: "community/file.pdf", ETag: "\"one\"", Size: 4 }], IsTruncated: true, NextContinuationToken: "next" }).mockResolvedValueOnce({ Body: Readable.from(["data"]) }) };
  const input = { config: { prefix: "community/" }, connection: { client, credentials: {}, settings: { bucket: "example", region: "eu-west-1", prefixes: ["community/"] } }, checkpoint: {}, signal: new AbortController().signal };
  const result = await page(input);
  expect(client.send.mock.calls[0][0].input).toMatchObject({ Bucket: "example", Prefix: "community/", MaxKeys: 100 });
  expect(result.checkpoint.cursor).toBe("next"); await result.entries[0].open(4);
  expect(client.send.mock.calls[1][0].input).toMatchObject({ IfMatch: "\"one\"", Key: "community/file.pdf" });
  input.config.prefix = "outside/"; await expect(page(input)).rejects.toThrow("approved prefix");
});

test("Nextcloud reads direct children, preserves ETags and denies parent traversal", async () => {
  const { page } = require("../../lib/plugins/nextcloud-collection");

  const xml = "<d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>/dav/Team/file.pdf</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>file.pdf</d:displayname><d:getetag>v1</d:getetag><d:getcontentlength>4</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>";
  const net = { response: jest.fn(async () => new Response(xml)), stream: jest.fn() };
  const input = { config: { folder: "Team" }, connection: { settings: { baseUrl: "https://example.org/dav" }, credentials: { username: "bot", password: "secret" } }, net };
  const result = await page(input); expect(result.entries).toHaveLength(1); expect(result.entries[0].revision).toBe("v1");
  result.entries[0].open(4); expect(net.stream.mock.calls[0][1].headers["if-match"]).toBe("v1");
  input.config.folder = "../private"; await expect(page(input)).rejects.toThrow("Parent path");
});

test("Drive snapshots a start token, follows folder changes and never imports another folder", async () => {
  const { page } = require("../../lib/plugins/drive-collection");

  const net = { json: jest.fn().mockResolvedValueOnce({ startPageToken: "start" }).mockResolvedValueOnce({ files: [{ id: "one", name: "file.pdf", version: "1", parents: ["folder"] }] }).mockResolvedValueOnce({ changes: [{ fileId: "foreign", file: { id: "foreign", parents: ["other"] } }, { fileId: "one", removed: true }], newStartPageToken: "updated" }) };
  const input = { config: { folderId: "folder" }, connection: { credentials: { accessToken: "private" }, settings: { folderIds: ["folder"] } }, checkpoint: {}, net };
  const first = await page(input); expect(first.checkpoint.changeToken).toBe("start"); expect(first.entries).toHaveLength(1);
  const next = await page({ ...input, checkpoint: first.checkpoint }); expect(next.entries).toEqual([expect.objectContaining({ id: "one", removed: true })]);
  input.config.folderId = "other"; await expect(page(input)).rejects.toThrow("outside");
});

test("Dropbox continues cursors, detects reset and enforces path boundaries", async () => {
  const { page } = require("../../lib/plugins/dropbox-collection");

  const net = { json: jest.fn(async () => ({ entries: [{ ".tag": "file", "id": "id:one", "path_lower": "/team/file.pdf", "name": "file.pdf", "rev": "v1", "size": 4 }, { ".tag": "file", "path_lower": "/team-other/private.pdf" }], cursor: "next", has_more: true })) };
  const input = { config: { folder: "/Team" }, connection: { credentials: { accessToken: "private" }, settings: { paths: ["/Team"] } }, checkpoint: { cursor: "old" }, net };
  const result = await page(input); expect(result.entries).toHaveLength(1); expect(result.checkpoint.cursor).toBe("next");
  expect(net.json.mock.calls[0][0]).toContain("list_folder/continue");
  net.json.mockRejectedValue({ status: 409 }); expect((await page(input)).checkpoint).toEqual({});
  input.config.folder = "/Team-other"; await expect(page(input)).rejects.toThrow("outside");
});

test("OneDrive validates delta continuations and handles removals and expired state", async () => {
  const { page } = require("../../lib/plugins/onedrive-collection");

  const net = { json: jest.fn(async () => ({ "value": [{ id: "one", name: "file.pdf", file: {}, eTag: "one" }, { id: "removed", deleted: {} }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive/items/folder/delta?token=next" })) };
  const input = { config: { folderId: "folder" }, connection: { credentials: { accessToken: "private" }, settings: { driveId: "drive", folderIds: ["folder"] } }, checkpoint: {}, net };
  const result = await page(input); expect(result.entries).toHaveLength(2); expect(result.entries[1].removed).toBe(true);
  await expect(page({ ...input, checkpoint: { cursor: "https://evil.example/private" } })).rejects.toThrow("continuation");
  net.json.mockRejectedValue({ status: 410 }); expect((await page(input)).checkpoint).toEqual({});
});

test("Hub collections require pinned commits, select exact paths and honor pagination", async () => {
  const { page } = require("../../lib/plugins/huggingface-collection");

  const config = { repository: "example/data", repositoryType: "datasets", revision: "a".repeat(40), files: ["selected.json"], license: "cc-by-4.0" };
  const net = { response: async () => new Response(JSON.stringify([{ type: "file", path: "selected.json", size: 4, oid: "one" }, { type: "file", path: "other.bin", size: 100 }])) };
  const result = await page({ config, connection: { credentials: {}, settings: {} }, checkpoint: {}, net });
  expect(result.entries).toHaveLength(1); expect(result.entries[0].license).toBe("cc-by-4.0");
  await expect(page({ config: { ...config, revision: "main" }, connection: {}, checkpoint: {}, net })).rejects.toThrow("pinned");
});


test("collector recovery inspects settings without credentials and clears the matching cursor", async () => {
  const stateFactory = createPluginStateFactory({memory: true});
  const connectionsFactory = require("../../lib/plugins/connections").createPluginConnections({getConfig: () => [{id: "source", provider: "test", pluginIds: ["synthetic"], roomIds: ["synthetic-room"], credentials: {tokenEnv: "MISSING_TOKEN"}, settings: {paths: ["b", "a"]}}], env: {}});

  const page = async() => ({entries: [], checkpoint: {cursor: "next"}});
  const collector = defineCollector({id: "synthetic", name: "Synthetic", provider: "test", properties: {connectionId: {type: "string"}}, page, stateFactory, connectionsFactory});
  const ctx = context({connectionId: "source"}); ctx.state = stateFactory({pluginId: "synthetic", roomId: "synthetic-room"});
  ctx.connections = {resolve: () => ({credentials: {token: "fixture"}, settings: {paths: ["a", "b"]}})};
  await collector.run(ctx, {mode: "run"});
  expect((await ctx.state.list()).entries).toHaveLength(1);
  expect(collector.syncLog.scope(ctx.config)).toContain("synthetic");
  await collector.syncLog.clearLocal(ctx.config);
  expect((await ctx.state.list()).entries).toHaveLength(0);
  expect(() => connectionsFactory({pluginId: "synthetic", roomId: "synthetic-room"}).resolve("source")).toThrow("credential is missing");
});


test("provider failures redact resolved connection secrets and preserve Retry-After", async () => {
  const collector = defineCollector({id: "synthetic", name: "Synthetic", provider: "test", properties: {}, page: async() => {
    throw Object.assign(new Error("Denied private-credential https://provider.example/private"), {retryable: true, retryAfterMs: 60000});
  }});
  const ctx = context({connectionId: "source"}); ctx.connections = {resolve: () => ({credentials: {password: "private-credential"}, settings: {}})};
  let failure; try {
    await collector.run(ctx);
  }
  catch(error) {
    failure = error;
  }
  expect(failure.message).not.toContain("private-credential"); expect(failure.message).not.toContain("provider.example"); expect(failure).toMatchObject({retryable: true, retryAfterMs: 60000}); expect(failure.message).toContain("retry");
});
