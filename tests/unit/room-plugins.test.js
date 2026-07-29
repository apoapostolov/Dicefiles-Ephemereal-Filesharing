"use strict";

const {
  normalizeRoomPlugins,
  upsertRoomPlugin,
  removeRoomPlugin,
  serializeRoomPlugins,
  findRoomPlugin,
} = require("../../lib/plugins/room-plugins");
const { createRoomPluginRuntime } = require("../../lib/plugins/room-runtime");
const {
  createMemoryEventLease,
} = require("../../lib/plugins/event-lease");
const path = require("path");

describe("room-plugins (shipped)", () => {
  test("normalize strips roomId hijack and caps list", () => {
    const list = normalizeRoomPlugins([
      {
        id: "mega-folder",
        enabled: true,
        config: { folderUrl: "https://mega.nz/folder/x", roomId: "evil" },
      },
      { id: "mega-folder", config: {} },
      null,
      { id: "" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("mega-folder");
    expect(list[0].config.roomId).toBeUndefined();
    expect(list[0].config.folderUrl).toMatch(/mega\.nz/);
  });

  test("upsert and remove", () => {
    let list = [];
    list = upsertRoomPlugin(list, {
      id: "mega-folder",
      config: { folderUrl: "https://mega.nz/folder/a", pollIntervalMinutes: 10 },
    });
    expect(list).toHaveLength(1);
    list = upsertRoomPlugin(list, {
      id: "mega-folder",
      enabled: false,
      config: { folderUrl: "https://mega.nz/folder/b" },
    });
    expect(list).toHaveLength(1);
    expect(list[0].enabled).toBe(false);
    expect(list[0].config.folderUrl).toMatch(/folder\/b/);
    list = removeRoomPlugin(list, "mega-folder");
    expect(list).toEqual([]);
  });

  test("serialize merges catalog labels", () => {
    const list = normalizeRoomPlugins([
      { id: "mega-folder", config: { pollIntervalMinutes: 5 } },
    ]);
    const ser = serializeRoomPlugins(list, {
      catalog: [
        {
          id: "mega-folder",
          name: "Mega.nz Autoshare",
          botName: "Mega.nz Autoshare",
          available: true,
          description: "monitor folder",
        },
      ],
    });
    expect(ser[0].botName).toBe("Mega.nz Autoshare");
    expect(ser[0].available).toBe(true);
    expect(findRoomPlugin(list, "mega-folder").config.pollIntervalMinutes).toBe(
      5,
    );
  });

  test("normalizes the former Mega.nz Autoshare display name", () => {
    const list = normalizeRoomPlugins([
      {
        id: "mega-folder",
        config: { botName: "Mega Autoshare" },
      },
    ]);

    expect(list[0].config.botName).toBe("Mega.nz Autoshare");
  });
});

describe("room-runtime catalog (shipped)", () => {
  test("listCatalog includes mega-folder from disk", () => {
    const rt = createRoomPluginRuntime({
      loadModule: (id) =>
        require("../../lib/plugins/registry").loadPluginModule(id, {
          pluginsRoot: path.join(__dirname, "../../lib/plugins"),
        }),
      log: { info() {}, warn() {}, error() {} },
    });
    const cat = rt.listCatalog();
    const mega = cat.find((c) => c.id === "mega-folder");
    expect(mega).toBeTruthy();
    expect(mega.available).toBe(true);
    expect(mega.botName).toBe("Mega.nz Autoshare");
  });

  test("runRoomPlugin uses room config roomId", async () => {
    const uploads = [];
    const rt = createRoomPluginRuntime({
      loadModule: (id) =>
        require("../../lib/plugins/registry").loadPluginModule(id, {
          pluginsRoot: path.join(__dirname, "../../lib/plugins"),
        }),
      buildCtx: () => ({
        megaDownloader: {
          async listFolder() {
            return [
              {
                name: "x.pdf",
                size: 2,
                async download() {
                  return Buffer.from("ok");
                },
              },
            ];
          },
        },
        syncLog: require("../../lib/plugins/sync-log").createMemorySyncLog({
          retentionDays: 30,
        }),
        async uploadFile(spec) {
          uploads.push(spec);
          return { key: "k1" };
        },
      }),
      log: { info() {}, warn() {}, error() {} },
    });
    const list = [
      {
        id: "mega-folder",
        enabled: true,
        config: {
          folderUrl: "https://mega.nz/folder/abc",
          pollIntervalMinutes: 0,
        },
      },
    ];
    const rv = await rt.runRoomPlugin("RoomHost99", "mega-folder", {}, list);
    expect(rv.uploaded).toBe(1);
    expect(uploads[0].roomId).toBe("RoomHost99");
    expect(uploads[0].role).toBe("bot");
  });

  test("scheduled runs are leased once across workers", async () => {
    const events = createMemoryEventLease({ retentionDays: 1 });
    let runs = 0;
    const plugin = {
      id: "test-plugin",
      name: "Test plugin",
      validateConfig() {
        return { ok: true };
      },
      async run() {
        runs++;
        return { runs };
      },
    };
    const makeRuntime = () =>
      createRoomPluginRuntime({
        now: () => 1_000_000,
        loadModule: () => ({ ok: true, plugin }),
        buildCtx: () => ({ events }),
        log: { info() {}, warn() {}, error() {} },
      });
    const list = [{
      id: "test-plugin",
      enabled: true,
      config: { pollIntervalMinutes: 5 },
    }];
    const first = await makeRuntime().runRoomPlugin(
      "RoomHost99",
      "test-plugin",
      { reason: "poll" },
      list,
    );
    const second = await makeRuntime().runRoomPlugin(
      "RoomHost99",
      "test-plugin",
      { reason: "poll" },
      list,
    );
    expect(first).toEqual({ runs: 1 });
    expect(second).toEqual({
      skipped: true,
      reason: "already_running_or_completed",
    });
    expect(runs).toBe(1);
  });
});
