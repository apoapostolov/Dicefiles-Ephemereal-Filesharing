"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

jest.mock("../../lib/config", () => new Map());
jest.mock("../../lib/media/jail", () => ({ spawnBounded: jest.fn() }));
const { createCompatible, durationOf, playlist } = require("../../lib/media/torrent-hls");

const folders = [];

function fixture(config = new Map()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hobbyfiles-hls-test-")); folders.push(dir);
  const controller = new AbortController();
  const session = { dir, signal: controller.signal };
  const run = jest.fn(async argv => ({ code: 0, stdout: argv[6] === "probe" ? Buffer.from(JSON.stringify({ format: { duration: "19.5" }, streams: [{ codec_type: "video", width: 1280, height: 720 }] })) : Buffer.from("synthetic segment") }));
  return { session, run, controller, compatible: createCompatible(session, { socket: path.join(dir, "relay.sock"), secret: "synthetic-private" }, 0, { config, run }) };
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("hobbyfiles-hls-test-")) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("VOD playlists expose the full timeline and independently seekable segments", () => {
  const body = playlist(19.5);
  expect(body).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
  expect(body).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
  expect(body).toContain("#EXTINF:1.500,\nsegment/3.ts");
  expect(body.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(3);
  expect(body.endsWith("#EXT-X-ENDLIST\n")).toBe(true);
});

test("duration probes reject invalid, excessive and non-video inputs", () => {
  expect(durationOf({ streams: [{ codec_type: "video" }], format: { duration: 660 } })).toBe(660);
  for (const probe of [{}, { streams: [{ codec_type: "audio" }], format: { duration: 20 } }, { streams: [{ codec_type: "video" }], format: { duration: 14401 } }, { streams: [{ codec_type: "video", width: 9000 }], format: { duration: 20 } }]) {
    expect(() => durationOf(probe)).toThrow("cannot be prepared");
  }
});

test("concurrent requests share the probe, seek directly, and reuse encoded segments", async () => {
  const { compatible, run } = fixture();
  expect(await Promise.all([compatible.inspect(), compatible.inspect()])).toEqual([{ duration: 19.5 }, { duration: 19.5 }]);
  const outputs = await Promise.all([compatible.segment(3), compatible.segment(3)]);
  expect(outputs[0].toString()).toBe("synthetic segment");
  await compatible.segment(3);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0].slice(-3)).toEqual(["segment", "18", "1.5"]);
  expect(run.mock.calls[1][1]).toMatchObject({ timeoutMs: 120000, maxBytes: 12 * 1024 ** 2, processGroup: true });
  await expect(compatible.segment(4)).rejects.toMatchObject({ status: 404 });
  expect(run).toHaveBeenCalledTimes(2);
});

test("native-tool policy and session cancellation stop conversion before spawning", async () => {
  const disabled = fixture(new Map([["nativeTools", false]]));
  await expect(disabled.compatible.inspect()).rejects.toThrow("native video tools are disabled");
  expect(disabled.run).not.toHaveBeenCalled();
  const aborted = fixture(); aborted.controller.abort();
  await expect(aborted.compatible.inspect()).rejects.toThrow("session ended");
  expect(aborted.run).not.toHaveBeenCalled();
});

test("failed probes retry and never forward native stderr to users", async () => {
  const { compatible, run } = fixture();
  run.mockResolvedValueOnce({ code: 1, stdout: Buffer.alloc(0), stderr: "private filesystem data" });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(compatible.inspect()).rejects.toThrow("Check that FFmpeg and FFprobe are installed");
    expect(await compatible.inspect()).toEqual({ duration: 19.5 });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("private filesystem data");
  }
  finally {
    warn.mockRestore();
  }
});
