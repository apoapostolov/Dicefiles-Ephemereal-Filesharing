"use strict";

const { Readable } = require("stream");
const { createHash } = require("crypto");
const { createGofileDownloader, parseSource } = require("../../lib/plugins/remote-import/gofile");
const { RemoteDownloaderRegistry } = require("../../lib/plugins/remote-downloaders");

const file = { id: "file1", name: "guide.pdf", type: "file", size: 5, link: "https://store1.gofile.io/download/file1/guide.pdf", md5: "synthetic" };
const response = (children, extra = {}) => new Response(JSON.stringify({ status: "ok", data: { type: "folder", children, ...extra } }));

test("Gofile exact source parsing and protected pagination", async () => {
  expect(parseSource("https://gofile.io.attacker.invalid/d/id")).toBeNull();
  expect(parseSource("http://gofile.io/d/id")).toBeNull();
  const fetchImpl = jest.fn().mockResolvedValue(response({ file1: file }, { childrenCount: 101 }));
  const provider = createGofileDownloader({ fetchImpl });
  const page = await provider.list(parseSource("https://gofile.io/d/root?tracker=1"), { credentials: { apiToken: "synthetic-token", password: "synthetic-password" }, pageSize: 100 });
  expect(page.nextCursor).toBe("2");
  expect(page.entries[0].sourceId).toBe("gofile:file:file1:synthetic");
  const [url, init] = fetchImpl.mock.calls[0];
  expect(new URL(url).searchParams.get("password")).toBe(createHash("sha256").update("synthetic-password").digest("hex"));
  expect(init.headers.authorization).toBe("Bearer synthetic-token");
  expect(JSON.stringify(page.entries)).not.toContain("synthetic-token");
});

test("Gofile rejects malformed pages, foreign download URLs, and truncated bytes", async () => {
  const provider = createGofileDownloader({ fetchImpl: jest.fn().mockResolvedValue(response({ file1: { ...file, link: "https://attacker.invalid/file" } })) });
  await expect(provider.list(parseSource("https://gofile.io/d/root"))).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
  const truncated = createGofileDownloader({ fetchImpl: async () => response({ file1: file }), streamImpl: async () => ({ ok: true, body: Readable.from([Buffer.from("bad")]) }) });
  const [entry] = await truncated.listFolder("https://gofile.io/d/root");
  await expect((async () => {
    for await (const chunk of await entry.openStream()) {
      void chunk;
    }
  })()).rejects.toMatchObject({ code: "DOWNLOAD_TRUNCATED" });
});

test("registry traverses folders breadth first and rejects repeated page cursors", async () => {
  const provider = createGofileDownloader({ fetchImpl: jest.fn().mockResolvedValueOnce(response({ child: { id: "child", type: "folder", name: "Child" }, file1: file })).mockResolvedValueOnce(response({ file2: { ...file, id: "file2" } })) });
  const registry = new RemoteDownloaderRegistry([provider]);
  const entries = [];
  for await (const item of registry.entries("https://gofile.io/d/root", {})) {
    entries.push(item.entry);
  }
  expect(entries.map(entry => entry.sourceId)).toEqual(["gofile:file:file1:synthetic", "gofile:file:file2:synthetic"]);
  const bad = new RemoteDownloaderRegistry([{ id: "bad", contractVersion: 1, canHandle: () => true, parseSource: () => ({ sourceId: "root" }), list: async () => ({ entries: [], nextCursor: "repeat" }) }]);
  await expect((async () => {
    for await (const item of bad.entries("https://example.org/root")) {
      void item;
    }
  })()).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
});
