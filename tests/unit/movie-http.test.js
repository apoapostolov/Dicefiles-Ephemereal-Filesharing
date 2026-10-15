"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const request = require("supertest");

function fixture({ password = true, invited = true, hidden = false, playback = true, expired = false } = {}) {
  const app = express();
  const item = { roomid: "synthetic-room", expired };
  const room = { invited: jest.fn(() => invited), passwordAccessAllowed: jest.fn(async () => password) };
  const serveTorrent = jest.fn(async (_req, res) => res.status(206).send("video bytes"));
  const library = {
    validateReference: reference => {
      if (!Number.isInteger(reference.index) || !["file", "link"].includes(reference.kind)) {
        throw new Error("Invalid video selection");
      }
      return "synthetic-record";
    },
    resolveReference: jest.fn(async () => {
      if (hidden) {
        throw new Error("This video is no longer available");
      } return { item, torrent: {}, name: "video.mp4" };
    }),
    RECORDS: { getFresh: jest.fn(async () => ({ subtitles: [{ id: "en", text: "WEBVTT\n\n00:01.000 --> 00:02.000\nHello" }] })) },
  };
  const modules = { "../media/library": library, "../upload": { Upload: { get: async () => item } }, "../links": { Link: { get: async () => item } }, "../room": { Room: { get: async () => room } }, "../config": new Map([["torrentPlayback", playback]]), "../media/torrent-stream": { serveTorrent } };
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(path.join(__dirname, "../../lib/http/media.js"), "utf8"), ["require", "module"])(name => modules[name], module);
  module.exports.registerMediaRoutes(app, { getUser: (_req, _res, next) => next(), rtoken: () => "synthetic-browser", aroute: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(() => res.status(403).json({ error: "Video access denied" })) });
  return { app, room, serveTorrent, library };
}

test.each([{ password: false }, { invited: false }, { hidden: true }, { expired: true }])("video and subtitle endpoints enforce current room policy %#", async options => {
  const f = fixture(options);
  for (const suffix of ["stream", "subtitle/en"]) {
    const response = await request(f.app).get(`/api/v1/media/file/video/0/${suffix}`);
    expect([403, 404]).toContain(response.status); expect(response.headers["cache-control"]).toBe("private, no-store");
  }
  expect(f.serveTorrent).not.toHaveBeenCalled(); expect(f.library.RECORDS.getFresh).not.toHaveBeenCalled();
});

test("subtitle bodies are returned as non-cacheable WebVTT and absent tracks give recovery", async () => {
  const f = fixture(); const response = await request(f.app).get("/api/v1/media/file/video/-1/subtitle/en");
  expect(response.status).toBe(200); expect(response.headers["content-type"]).toContain("text/vtt"); expect(response.text).toContain("Hello");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect((await request(f.app).get("/api/v1/media/file/video/-1/subtitle/missing")).status).toBe(404);
});

test("payload playback flag is independent of subtitle access and valid range playback", async () => {
  const f = fixture({ playback: false });
  expect((await request(f.app).get("/api/v1/media/file/video/0/stream")).status).toBe(503);
  expect((await request(f.app).get("/api/v1/media/file/video/-1/subtitle/en")).status).toBe(200);
  expect(f.serveTorrent).not.toHaveBeenCalled();
  const enabled = fixture(); expect((await request(enabled.app).get("/api/v1/media/link/video/0/stream")).status).toBe(206);
  expect(enabled.serveTorrent).toHaveBeenCalledTimes(1);
});
