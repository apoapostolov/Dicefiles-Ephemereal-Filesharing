"use strict";

const {
  normalizeRoomPlugins,
  upsertRoomPlugin,
  removeRoomPlugin,
  serializeRoomPlugins,
  findRoomPlugin,
} = require("../../lib/plugins/room-plugins");
const { createRoomPluginRuntime } = require("../../lib/plugins/room-runtime");
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
          name: "Mega Autoshare",
          botName: "Mega Autoshare",
          available: true,
          description: "monitor folder",
        },
      ],
    });
    expect(ser[0].botName).toBe("Mega Autoshare");
    expect(ser[0].available).toBe(true);
    expect(findRoomPlugin(list, "mega-folder").config.pollIntervalMinutes).toBe(
      5,
    );
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
    expect(mega.botName).toMatch(/Mega/i);
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
});
