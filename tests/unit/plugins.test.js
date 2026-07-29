"use strict";

const path = require("path");
const { Readable } = require("stream");
const {
  normalizePluginConfigs,
  validatePluginShape,
  loadPluginModule,
  PluginRegistry,
} = require("../../lib/plugins/registry");
const mega = require("../../lib/plugins/mega-folder");
const { runMegaFolderSync, validateConfig } = mega;

describe("plugin registry (shipped)", () => {
  test("normalizePluginConfigs", () => {
    expect(normalizePluginConfigs(null)).toEqual([]);
    expect(
      normalizePluginConfigs([
        { id: "mega-folder", enabled: true, config: { roomId: "x" } },
        { id: "mega-folder" },
        {},
      ]),
    ).toEqual([
      {
        id: "mega-folder",
        enabled: true,
        config: { roomId: "x" },
      },
    ]);
  });

  test("loadPluginModule mega-folder", () => {
    const res = loadPluginModule("mega-folder", {
      pluginsRoot: path.join(__dirname, "../../lib/plugins"),
    });
    expect(res.ok).toBe(true);
    expect(res.plugin.id).toBe("mega-folder");
    expect(validatePluginShape(res.plugin).ok).toBe(true);
  });

  test("registry loadFromConfig + emitEvent + run with injectable Mega.nz I/O", async () => {
    const registry = new PluginRegistry();
    const { loaded, errors } = registry.loadFromConfig(
      [
        {
          id: "mega-folder",
          enabled: true,
          config: {
            folderUrl: "https://mega.nz/folder/abc",
            roomId: "destRoom01",
            pollEvents: ["linked_file_appeared"],
          },
        },
      ],
      { pluginsRoot: path.join(__dirname, "../../lib/plugins") },
    );
    expect(errors).toEqual([]);
    expect(loaded).toEqual(["mega-folder"]);

    const events = [];
    await registry.startAll({
      log: { info() {} },
      scheduleRun(id, args) {
        events.push({ id, args });
      },
    });
    await registry.emitEvent("linked_file_appeared", {
      roomid: "hub",
      key: "k1",
    });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("mega-folder");

    const uploads = [];
    // run without megaDownloader should throw
    await expect(registry.run("mega-folder", {})).rejects.toThrow(
      /megaDownloader/,
    );

    // direct run with inject
    const { createMemorySyncLog } = require("../../lib/plugins/sync-log");
    const sync = await runMegaFolderSync(
      {
        config: {
          folderUrl: "https://mega.nz/folder/abc",
          roomId: "destRoom01",
          namePrefix: "mega-",
        },
        megaDownloader: {
          async listFolder() {
            return [
              {
                name: "rules.pdf",
                size: 12,
                async download() {
                  return Buffer.from("hello-pdf!!!");
                },
              },
              { name: "subdir", isDir: true },
            ];
          },
        },
        syncLog: createMemorySyncLog({ retentionDays: 30 }),
        async uploadFile(spec) {
          uploads.push(spec);
          return { key: "up1" };
        },
      },
      {},
    );
    expect(sync.uploaded).toBe(1);
    expect(sync.skipped).toBe(1);
    expect(uploads[0].name).toBe("mega-rules.pdf");
    expect(uploads[0].roomId).toBe("destRoom01");
    expect(uploads[0].role).toBe("bot");
    expect(uploads[0].botName).toBeTruthy();
    expect(uploads[0].meta.bot).toBe(true);
  });

  test("global scheduled runs share a cross-worker event lease", async () => {
    const {
      createMemoryEventLease,
    } = require("../../lib/plugins/event-lease");
    const events = createMemoryEventLease();
    let runs = 0;
    const plugin = {
      id: "leased-test",
      name: "Leased test",
      async run() {
        runs++;
        return { delivered: 1 };
      },
    };
    const makeRegistry = async () => {
      const registry = new PluginRegistry();
      registry.register(
        plugin,
        { roomId: "room1234", pollIntervalMinutes: 5 },
        true,
      );
      await registry.startAll({ events });
      return registry;
    };
    const first = await makeRegistry();
    const second = await makeRegistry();
    await expect(
      first.run("leased-test", { reason: "poll" }),
    ).resolves.toEqual({ delivered: 1 });
    await expect(
      second.run("leased-test", { reason: "poll" }),
    ).resolves.toEqual({
      skipped: true,
      reason: "already_running_or_completed",
    });
    expect(runs).toBe(1);
  });

  test("mega-folder dedupes name+size across runs (local + durable log)", async () => {
    mega._test.seenByScope.clear();
    const { createMemorySyncLog } = require("../../lib/plugins/sync-log");
    const syncLog = createMemorySyncLog({ retentionDays: 30 });
    const uploads = [];
    const downloader = {
      async listFolder() {
        return [
          {
            name: "once.pdf",
            size: 4,
            async download() {
              return Buffer.from("once");
            },
          },
        ];
      },
    };
    const ctx = {
      config: {
        folderUrl: "https://mega.nz/folder/abc",
        roomId: "destRoom01",
      },
      megaDownloader: downloader,
      syncLog,
      async uploadFile(spec) {
        uploads.push(spec.name);
        return { key: "k" + uploads.length };
      },
    };
    const r1 = await runMegaFolderSync(ctx, {});
    const r2 = await runMegaFolderSync(ctx, {});
    expect(r1.uploaded).toBe(1);
    expect(r2.uploaded).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(uploads).toEqual(["once.pdf"]);

    // Simulate process restart: clear local cache, durable log still skips
    mega._test.seenByScope.clear();
    const r3 = await runMegaFolderSync(ctx, {});
    expect(r3.uploaded).toBe(0);
    expect(r3.skipped).toBe(1);
    expect(uploads).toEqual(["once.pdf"]);
  });

  test("mega-folder keeps a source-stable identity across remote renames", async () => {
    mega._test.seenByScope.clear();
    const {
      createMemorySyncLog,
    } = require("../../lib/plugins/sync-log");
    const syncLog = createMemorySyncLog({ retentionDays: 30 });
    const uploads = [];
    let name = "original.pdf";
    const context = {
      config: {
        folderUrl: "https://mega.nz/folder/stable",
        roomId: "destRoom01",
      },
      megaDownloader: {
        async listFolder() {
          return [
            {
              name,
              size: 4,
              sourceId: "stable-mega-node",
              async download() {
                return Buffer.from("same");
              },
            },
          ];
        },
      },
      syncLog,
      async uploadFile(spec) {
        uploads.push(spec.name);
        return { key: spec.name, size: 4 };
      },
    };
    expect((await runMegaFolderSync(context, {})).uploaded).toBe(1);
    mega._test.seenByScope.clear();
    name = "renamed.pdf";
    const second = await runMegaFolderSync(context, {});
    expect(second.uploaded).toBe(0);
    expect(second.skippedByReason.alreadyImported).toBe(1);
    expect(uploads).toEqual(["original.pdf"]);
  });

  test("mega-folder treats matching room content as already imported", async () => {
    mega._test.seenByScope.clear();
    const {
      createMemorySyncLog,
    } = require("../../lib/plugins/sync-log");
    const result = await runMegaFolderSync({
      config: {
        folderUrl: "https://mega.nz/folder/content",
        roomId: "destRoom01",
      },
      megaDownloader: {
        async listFolder() {
          return [
            {
              name: "duplicate.pdf",
              size: 4,
              sourceId: "duplicate-node",
              async download() {
                return Buffer.from("same");
              },
            },
          ];
        },
      },
      syncLog: createMemorySyncLog({ retentionDays: 30 }),
      async uploadFile() {
        const error = new Error("duplicate");
        error.code = "DUPLICATE_ROOM_CONTENT";
        throw error;
      },
    });
    expect(result.uploaded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedByReason.existingRoom).toBe(1);
  });

  test("mega-folder prefers a streaming provider body", async () => {
    mega._test.seenByScope.clear();
    const {
      createMemorySyncLog,
    } = require("../../lib/plugins/sync-log");
    let streamed = false;
    const result = await runMegaFolderSync({
      config: {
        folderUrl: "https://mega.nz/folder/stream",
        roomId: "destRoom01",
      },
      megaDownloader: {
        async listFolder() {
          return [
            {
              name: "stream.bin",
              size: 6,
              sourceId: "stream-node",
              async openStream() {
                return Readable.from([Buffer.from("stream")]);
              },
              async download() {
                throw new Error("buffer fallback must not be used");
              },
            },
          ];
        },
      },
      syncLog: createMemorySyncLog({ retentionDays: 30 }),
      async uploadFile(spec) {
        streamed = typeof spec.body.pipe === "function";
        return { key: "streamed", size: 6 };
      },
    });
    expect(result.uploaded).toBe(1);
    expect(streamed).toBe(true);
  });

  test("mega-folder enforces per-run file and byte limits", async () => {
    mega._test.seenByScope.clear();
    const { createMemorySyncLog } = require("../../lib/plugins/sync-log");
    const uploads = [];
    const result = await runMegaFolderSync({
      config: {
        folderUrl: "https://mega.nz/folder/limits",
        roomId: "destRoom01",
        maxFilesPerRun: 2,
        maxBytesPerFile: 5,
        maxBytesPerRun: 8,
      },
      megaDownloader: {
        async listFolder() {
          return [
            {
              name: "one.bin",
              size: 4,
              async download() {
                return Buffer.alloc(4);
              },
            },
            {
              name: "too-large.bin",
              size: 6,
              async download() {
                throw new Error("oversized files must not be downloaded");
              },
            },
            {
              name: "two.bin",
              size: 4,
              async download() {
                return Buffer.alloc(4);
              },
            },
            {
              name: "file-limit.bin",
              size: 1,
              async download() {
                throw new Error("files beyond the cap must not be downloaded");
              },
            },
          ];
        },
      },
      syncLog: createMemorySyncLog({ retentionDays: 30 }),
      async uploadFile(spec) {
        uploads.push(spec.name);
        return { key: spec.name };
      },
    });
    expect(uploads).toEqual(["one.bin", "two.bin"]);
    expect(result.uploaded).toBe(2);
    expect(result.uploadedBytes).toBe(8);
    expect(result.skippedByReason.fileTooLarge).toBe(1);
    expect(result.skippedByReason.fileLimit).toBe(1);
  });
});

describe("mega-folder validateConfig (shipped)", () => {
  test("requires folderUrl and roomId", () => {
    expect(validateConfig({}).ok).toBe(false);
    expect(
      validateConfig({
        folderUrl: "https://mega.nz/folder/x",
        roomId: "abcd",
      }).ok,
    ).toBe(true);
    expect(
      validateConfig({
        folderUrl: "https://example.com/x",
        roomId: "abcd",
      }).ok,
    ).toBe(false);
  });

  test("requires positive whole-number import limits", () => {
    expect(
      validateConfig({
        folderUrl: "https://mega.nz/folder/x",
        roomId: "abcd",
        maxFilesPerRun: 0,
      }).ok,
    ).toBe(false);
    expect(
      validateConfig({
        folderUrl: "https://mega.nz/folder/x",
        roomId: "abcd",
        maxBytesPerRun: 1024,
      }).ok,
    ).toBe(true);
  });
});
