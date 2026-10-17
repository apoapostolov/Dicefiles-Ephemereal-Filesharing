"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { bufferingStatus } = require("../../common/video");

const moduleUnderTest = { exports: {} };
vm.compileFunction(fs.readFileSync(path.join(__dirname, "../../lib/media/torrent-stream.js"), "utf8"), ["require", "module"])(name => name.startsWith("../") ? {} : require(name), moduleUnderTest);
const { playbackProgress } = moduleUnderTest.exports;

test("progress counts verified parts for the selected file and estimates the next buffer, not the whole movie", () => {
  const session = { torrent: { pieceLength: 1024, bitfield: { get: part => [0, 2].includes(part) }, files: [{ offset: 512, length: 4096 }], pieces: [{}, { missing: 512 }], downloadSpeed: 256, numPeers: 3 }, reads: new Map([[1, { index: 0, start: 0, end: 4095 }], [2, { index: 1, start: 0, end: 99999 }]]) };
  expect(playbackProgress(session, 0)).toEqual({ phase: "buffering", downloadedParts: 2, totalParts: 5, bytesPerSecond: 256, peers: 3, etaSeconds: 2 });
  session.torrent.downloadSpeed = 0;
  expect(playbackProgress(session, 0).etaSeconds).toBeNull();
  session.torrent.downloadSpeed = 1;
  expect(playbackProgress(session, 0).etaSeconds).toBeNull();
  session.torrent.downloadSpeed = 256; session.torrent.numPeers = 0;
  expect(playbackProgress(session, 0).etaSeconds).toBeNull();
  session.videoPhases = new Map([[0, "converting"]]);
  session.reads.clear();
  expect(playbackProgress(session, 0)).toMatchObject({ phase: "converting", etaSeconds: null });
});

test("buffering copy uses real counters and an explicitly approximate startup estimate", () => {
  expect(bufferingStatus({ phase: "buffering", downloadedParts: 12, totalParts: 100, bytesPerSecond: 2 * 1024 ** 2, etaSeconds: 3.1 })).toBe("Buffering video… · 12 / 100 parts · 2.0 MiB/s · ~4s to buffer");
  expect(bufferingStatus({ phase: "connecting" })).toBe("Finding video peers… · Estimating start…");
  expect(bufferingStatus({ phase: "converting" })).toBe("Preparing video… · Preparing playback…");
  expect(bufferingStatus({}, 1.9)).toContain("1s buffered");
  expect(bufferingStatus({ totalParts: 99, downloadedParts: 0, peers: 0, bytesPerSecond: 0 })).toContain("Waiting for video peers…");
});
