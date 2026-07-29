"use strict";

const path = require("path");
const { Readable } = require("stream");
const {
  createUploadFileAdapter,
  createMegaDownloader,
  buildPluginRuntimeCtx,
} = require("../../lib/plugins/runtime-adapters");
const { PluginRegistry } = require("../../lib/plugins/registry");

describe("plugin runtime adapters (shipped)", () => {
  test("createUploadFileAdapter uses getRoom + ingestFromBuffer as bot", async () => {
    const ingested = [];
    const uploadFile = createUploadFileAdapter({
      botName: "Mega.nz Autoshare",
      async getRoom(id) {
        expect(id).toBe("destRoom99");
        return { fileTTL: 12 };
      },
      async ingestFromBuffer(opts) {
        ingested.push(opts);
        return {
          key: "kUpload1",
          href: "/g/kUpload1",
          name: opts.name,
          size: opts.buffer.length,
          meta: opts.meta,
        };
      },
    });

    const rv = await uploadFile({
      roomId: "destRoom99",
      name: "from-mega.pdf",
      body: Buffer.from("pdf-bytes-here"),
      meta: { plugin: "mega-folder" },
    });
    expect(rv.key).toBe("kUpload1");
    expect(ingested).toHaveLength(1);
    expect(ingested[0].roomid).toBe("destRoom99");
    expect(ingested[0].name).toBe("from-mega.pdf");
    expect(ingested[0].ttl).toBe(12);
    expect(ingested[0].role).toBe("bot");
    expect(ingested[0].user).toBe("Mega.nz Autoshare");
    expect(ingested[0].meta.bot).toBe(true);
    expect(ingested[0].meta.botName).toBe("Mega.nz Autoshare");
    expect(ingested[0].meta.plugin).toBe("mega-folder");
    expect(Buffer.isBuffer(ingested[0].buffer)).toBe(true);
  });

  test("createMegaDownloader without SDK throws clear listFolder error", async () => {
    const dl = createMegaDownloader({
      megajs: null,
    });
    expect(dl.sdkAvailable).toBe(false);
    await expect(
      dl.listFolder("https://mega.nz/folder/x", {}),
    ).rejects.toThrow(/megajs is not installed/);
  });

  test("createUploadFileAdapter streams without buffering in process memory", async () => {
    const streamed = [];
    const uploadFile = createUploadFileAdapter({
      async getRoom() {
        return { fileTTL: 24 };
      },
      async ingestFromBuffer() {
        throw new Error("buffer ingest must not be used for a stream");
      },
      async ingestFromStream(opts) {
        streamed.push(opts);
        return {
          key: "streamed1",
          name: opts.name,
          size: 6,
          meta: opts.meta,
        };
      },
    });
    const body = Readable.from([Buffer.from("stream")]);
    const result = await uploadFile({
      roomId: "destRoom99",
      name: "large.bin",
      body,
      maxBytes: 1024,
      skipIfRoomHashExists: true,
    });
    expect(result.key).toBe("streamed1");
    expect(streamed).toHaveLength(1);
    expect(streamed[0].stream).toBe(body);
    expect(streamed[0].maxBytes).toBe(1024);
    expect(streamed[0].skipIfRoomHashExists).toBe(true);
  });

  test("createMegaDownloader with fake megajs lists files", async () => {
    const fakeFile = {
      name: "folder",
      directory: true,
      children: [
        {
          name: "sheet.pdf",
          size: 42,
          directory: false,
          async downloadBuffer() {
            return Buffer.from("PDFDATA");
          },
        },
        { name: "sub", directory: true, children: [] },
      ],
      async loadAttributes() {},
    };
    const dl = createMegaDownloader({
      megajs: {
        File: {
          fromURL() {
            return fakeFile;
          },
        },
      },
    });
    expect(dl.sdkAvailable).toBe(true);
    const entries = await dl.listFolder("https://mega.nz/folder/abc", {});
    expect(entries.some((e) => e.name === "sheet.pdf")).toBe(true);
    const file = entries.find((e) => e.name === "sheet.pdf");
    const buf = await file.download();
    expect(Buffer.from(buf).toString()).toBe("PDFDATA");
  });

  test("startAll wires adapters so registry.run mega-folder succeeds", async () => {
    const uploads = [];
    const registry = new PluginRegistry();
    const { loaded, errors } = registry.loadFromConfig(
      [
        {
          id: "mega-folder",
          enabled: true,
          config: {
            folderUrl: "https://mega.nz/folder/abc",
            roomId: "destRoom01",
          },
        },
      ],
      { pluginsRoot: path.join(__dirname, "../../lib/plugins") },
    );
    expect(errors).toEqual([]);
    expect(loaded).toEqual(["mega-folder"]);

    const runtime = buildPluginRuntimeCtx({
      log: { info() {}, warn() {}, error() {} },
      megaDownloader: {
        sdkAvailable: true,
        sdkName: "fake",
        async listFolder() {
          return [
            {
              name: "rules.pdf",
              size: 9,
              async download() {
                return Buffer.from("rules-pdf");
              },
            },
          ];
        },
      },
      getRoom: async () => ({ fileTTL: 24 }),
      ingestFromBuffer: async (opts) => {
        uploads.push(opts);
        return { key: "up99", href: "/g/up99", name: opts.name, size: 9 };
      },
      scheduleRun() {},
    });

    await registry.startAll(runtime);
    // scheduleRun → run must NOT throw when adapters are on ctx
    const result = await registry.run("mega-folder", {});
    expect(result.uploaded).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].name).toBe("rules.pdf");
    expect(uploads[0].roomid).toBe("destRoom01");
  });
});
