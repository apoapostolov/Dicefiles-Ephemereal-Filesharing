"use strict";

const path = require("path");
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

  test("registry loadFromConfig + emitEvent + run with injectable mega I/O", async () => {
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
});
