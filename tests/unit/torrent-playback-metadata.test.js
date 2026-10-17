"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const moduleUnderTest = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, "../../lib/media/torrent-stream.js"), "utf8");
vm.compileFunction(source, ["require", "module"])(name => name.startsWith("../") ? {} : require(name), moduleUnderTest);
const { playbackMetadata } = moduleUnderTest.exports;

test("playback reaches useful metadata beyond the old six-peer cutoff", async () => {
  const contacts = Array.from({ length: 48 }, (_, id) => ({ id }));
  const metainfo = Buffer.from("synthetic verified metadata");
  const lookup = jest.fn(async peer => {
    if (peer.id !== 24) {
      throw new Error("stale contact");
    }
    return { metainfo };
  });
  const peerId = Buffer.alloc(20, 65);
  expect(await playbackMetadata(contacts, {}, peerId, { lookup })).toBe(metainfo);
  expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(25);
  expect(lookup.mock.calls[0][2].peerId).toBe(peerId);
  expect(lookup.mock.calls[0][2].signal.aborted).toBe(true);
});

test("empty and cancelled lookups produce an actionable startup error", async () => {
  await expect(playbackMetadata([], {}, Buffer.alloc(20))).rejects.toThrow("upload its .torrent file");
  const controller = new AbortController(); controller.abort();
  const lookup = jest.fn();
  await expect(playbackMetadata([{}], {}, Buffer.alloc(20), { lookup, signal: controller.signal })).rejects.toThrow("metadata available");
  expect(lookup).not.toHaveBeenCalled();
});
