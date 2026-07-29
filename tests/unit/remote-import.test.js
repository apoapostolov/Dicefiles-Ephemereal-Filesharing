"use strict";

const { Readable } = require("stream");
const {
  RemoteDownloaderRegistry,
} = require("../../lib/plugins/remote-downloaders");
const {
  parseSource,
  createPixeldrainDownloader,
} = require("../../lib/plugins/remote-import/pixeldrain");
const {
  runRemoteImport,
  validateConfig,
} = require("../../lib/plugins/remote-import");
const {
  createMemorySyncLog,
} = require("../../lib/plugins/sync-log");

describe("remote downloader registry", () => {
  test("uses an exact provider hostname and rejects unsupported sources", () => {
    const registry = new RemoteDownloaderRegistry([
      {
        id: "safe",
        canHandle(url) {
          return url.hostname === "files.example";
        },
        async listFolder() {
          return [];
        },
      },
    ]);
    expect(registry.resolve("https://files.example/one").id).toBe("safe");
    expect(() =>
      registry.resolve("https://files.example.attacker.invalid/one"),
    ).toThrow(/No enabled downloader/);
    expect(() =>
      registry.resolve("file:///etc/passwd"),
    ).toThrow(/HTTP or HTTPS/);
    expect(() =>
      registry.resolve("https://user:pass@files.example/one"),
    ).toThrow(/Credentials are not allowed/);
  });
});

describe("Pixeldrain downloader", () => {
  test("parses only official single-file and list links", () => {
    expect(parseSource("https://pixeldrain.com/u/abc_123")).toEqual({
      kind: "file",
      id: "abc_123",
    });
    expect(parseSource("https://pixeldrain.com/l/list-1")).toEqual({
      kind: "list",
      id: "list-1",
    });
    expect(parseSource("https://pixeldrain.com.attacker.invalid/u/x")).toBeNull();
    expect(parseSource("https://pixeldrain.com/d/dir")).toBeNull();
  });

  test("resolves file metadata and returns a streaming body", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            id: "abc",
            name: "guide.pdf",
            size: 5,
            hash_sha256: "deadbeef",
          };
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: Readable.from([Buffer.from("bytes")]),
      });
    const downloader = createPixeldrainDownloader({ fetchImpl });
    const [entry] = await downloader.listFolder(
      "https://pixeldrain.com/u/abc",
      {},
    );
    expect(entry).toMatchObject({
      name: "guide.pdf",
      size: 5,
      sourceId: "pixeldrain:file:abc:deadbeef",
    });
    const stream = await entry.openStream();
    expect(stream).toBeInstanceOf(Readable);
  });
});

describe("remote-import plugin", () => {
  test("imports bounded streams and remembers stable provider identities", async () => {
    const syncLog = createMemorySyncLog({ retentionDays: 30 });
    const uploads = [];
    const context = {
      config: {
        roomId: "roomRemote1",
        urls: ["https://pixeldrain.com/u/abc"],
      },
      remoteDownloaders: {
        async listFolder() {
          return {
            provider: { id: "pixeldrain" },
            entries: [
              {
                name: "guide.pdf",
                size: 5,
                sourceId: "pixeldrain:file:abc:hash",
                async openStream() {
                  return Readable.from([Buffer.from("bytes")]);
                },
              },
            ],
          };
        },
      },
      syncLog,
      async uploadFile(spec) {
        uploads.push(spec);
        return { key: "remote1", size: 5 };
      },
    };
    const first = await runRemoteImport(context, {});
    const second = await runRemoteImport(context, {});
    expect(first.uploaded).toBe(1);
    expect(second.uploaded).toBe(0);
    expect(second.skippedByReason.alreadyImported).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].body).toBeInstanceOf(Readable);
    expect(uploads[0].skipIfRoomHashExists).toBe(true);
  });

  test("validates URL protocols and positive import limits", () => {
    expect(
      validateConfig({
        roomId: "roomRemote1",
        urls: ["https://pixeldrain.com/u/abc"],
      }).ok,
    ).toBe(true);
    expect(
      validateConfig({
        roomId: "roomRemote1",
        urls: ["file:///etc/passwd"],
      }).ok,
    ).toBe(false);
    expect(
      validateConfig({
        roomId: "roomRemote1",
        urls: ["https://pixeldrain.com/u/abc"],
        maxFilesPerRun: 0,
      }).ok,
    ).toBe(false);
  });
});
