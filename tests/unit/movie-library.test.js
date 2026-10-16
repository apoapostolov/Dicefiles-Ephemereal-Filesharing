"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ owner = true, visible = true, expired = false, password = true } = {}) {
  class DMap extends Map {
    constructor(input) {
      super(Array.isArray(input) ? input : []);
    }
    get loaded() {
      return Promise.resolve();
    }
    async getFresh(key) {
      return this.get(key);
    }
    async entriesFresh() {
      return [...this];
    }
    async setDurable(key, value) {
      this.set(key, value);
    }
    async updateAtomic(key, fn) {
      const next = fn(this.get(key)); this.set(key, next); return next;
    }
  }

  class Upload {
    constructor(data) {
      Object.assign(this, data);
    }
    toJSON() {
      return { ...this };
    }
    static async get() {
      return upload;
    }
  }

  const upload = new Upload({ key: "video", roomid: "room", type: "video", name: "Example.2020.mp4", ip: owner ? "viewer" : "other", meta: { duration: "0:11:00" }, expires: Date.now() + 86400000, expired });
  const uploads = new DMap([["video", upload]]);
  const catalog = { providers: { tmdb: true }, search: jest.fn(async () => ({ candidates: [{ title: "Example" }] })), resolve: jest.fn(async () => ({ title: "Example", kind: "movie", year: "2020" })) };
  const modules = {
    "../broker/collections": { DistributedMap: DMap }, "../config": new Map(), "../redis-lease": { withLease: (_key, action) => action(async () => {}) },
    "./catalog": { MediaCatalog: class {
      constructor() {
        return catalog;
      }
    } }, "node:crypto": require("node:crypto"), "./subtitles": require("../../lib/media/subtitles"), "../../common/video": require("../../common/video"), "../upload": { Upload, UPLOADS: uploads }, "../broker": { getMethods: () => ({ ratelimit: async () => [1] }) }, "../links": { Link: { get: async () => ({ roomid: "other" }) } },
  };
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(path.join(__dirname, "../../lib/media/library.js"), "utf8"), ["require", "module", "setInterval"])(name => modules[name], module, () => ({ unref() {} }));
  const client = { socket: { handshake: { cookies: {} } }, invited: true, disabled: false, ip: "viewer", role: "white", roomid: "room", checkUploadAccess: jest.fn(async () => {}), room: { config: new DMap(), files: { for: async () => visible ? [upload] : [] }, passwordAccessAllowed: jest.fn(async () => password) } };
  const reference = { kind: "file", key: "video", index: -1 };
  return { ...module.exports, client, reference, upload, uploads, catalog, call: (operation, input) => module.exports.mediaAction(client, reference, operation, input) };
}

test("only visible, current, unlocked room videos can load metadata", async () => {
  for (const options of [{ visible: false }, { expired: true }, { password: false }]) {
    await expect(fixture(options).call("get")).rejects.toThrow();
  }
  const f = fixture(); expect(await f.call("get")).toMatchObject({ editable: true, duration: 660, name: "Example.2020.mp4" });
  await expect(f.mediaAction(f.client, { kind: "link", key: "foreign", index: 0 }, "get")).rejects.toThrow("no longer available");
});

test("viewers can search, but cannot change another uploader's match or subtitles", async () => {
  const f = fixture({ owner: false }); expect(await f.call("get")).toMatchObject({ editable: false });
  expect((await f.call("search", "Example")).candidates).toHaveLength(1);
  await expect(f.call("match", "anything")).rejects.toThrow("Only the uploader");
  await expect(f.call("subtitle", { text: "x", language: "en" })).rejects.toThrow("Only the uploader");
  expect(f.catalog.resolve).not.toHaveBeenCalled();
});

test("confirmed matches preserve the uploaded filename and survive later subtitle edits", async () => {
  const f = fixture(); const movie = await f.call("match", { provider: "tmdb", id: "1", kind: "movie" });
  expect(movie.movie.title).toBe("Example"); expect(f.uploads.get("video").name).toBe("Example.2020.mp4");
  const added = await f.call("subtitle", { text: "1\n00:00:01,000 --> 00:00:02,000\nHello", language: "en", filename: "Example.English.srt" });
  expect(added.movie.title).toBe("Example"); expect(added.subtitles).toHaveLength(1); expect(added.subtitles[0].text).toBeUndefined();
  expect(added.subtitles[0].filename).toBe("Example.English.srt");
  expect(JSON.stringify(f.uploads.get("video").meta.cinema)).not.toContain("WEBVTT");
  expect(JSON.stringify(await f.call("get"))).not.toContain("WEBVTT");
  const removed = await f.call("remove-subtitle", added.subtitles[0].id); expect(removed.subtitles).toEqual([]);
  expect((await f.call("unmatch")).movie).toBeNull();
});

test("four subtitle tracks and reference syntax are enforced", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) {
    await f.call("subtitle", { text: "WEBVTT\n\n00:01.000 --> 00:02.000\nHello", language: "en" });
  }
  await expect(f.call("subtitle", { text: "WEBVTT\n\n00:01.000 --> 00:02.000\nHello", language: "en" })).rejects.toThrow("four subtitle");
  for (const reference of [null, { kind: "file", key: "../secret", index: -1 }, { kind: "file", key: "video", index: 0.5 }, { kind: "file", key: "video", index: 2000 }]) {
    expect(() => f.validateReference(reference)).toThrow("Invalid");
  }
});

test("automatic matches preserve subtitles, and manually removed matches are never reapplied", async () => {
  const f = fixture(); const path = "Example.2020.mp4"; const hash = "a".repeat(40);
  f.upload.meta.torrent = { infoHashV1: hash, files: [{ path }] };
  f.RECORDS.set("file:video:0", { expires: f.upload.expires, subtitles: [{ id: "track", language: "en", label: "English", text: "private subtitle body" }] });
  const reference = { kind: "file", key: "video", index: 0 };
  const result = { movie: { title: "Example", kind: "movie" }, autoMatch: { state: "matched", confidence: "high" } };
  expect(await f.applyAutomaticMatch(reference, { path, hash }, result)).toBe(true);
  expect(f.RECORDS.get("file:video:0").subtitles[0].text).toBe("private subtitle body");
  expect(JSON.stringify(f.uploads.get("video").meta.cinema)).not.toContain("private subtitle body");
  f.RECORDS.set("file:video:0", { autoMatch: { state: "manual" } });
  f.uploads.get("video").meta.cinema[0] = { autoMatch: { state: "manual" } };
  expect(await f.applyAutomaticMatch(reference, { path, hash }, result)).toBe(false);
  expect(await f.applyAutomaticMatch(reference, { path: "changed.mp4", hash }, result)).toBe(false);
});
