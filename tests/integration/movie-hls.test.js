"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

jest.mock("../../lib/config", () => new Map([["nativeTools", true], ["jail", process.env.HOBBYFILES_TEST_JAIL === "true"]]));
const { serveCompatible } = require("../../lib/media/torrent-hls");

const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
const probeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;
const nativeTest = encoders.status === 0 && encoders.stdout.includes("libx265") && probeAvailable ? test : test.skip;

nativeTest("HEVC MKV becomes independently decodable HLS sections through the authenticated range relay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hobbyfiles-stream-hls-test-"));
  const video = path.join(dir, "source.mkv");
  const encode = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "14", "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "pools=1:frame-threads=1:log-level=error", "-c:a", "aac", video], { encoding: "utf8", timeout: 30000 });
  expect(encode.status).toBe(0);
  const length = fs.statSync(video).size;
  const controller = new AbortController();
  const session = { dir, active: 0, touched: Date.now(), signal: controller.signal, torrent: { name: "Fixture", files: [{ name: "source.mkv", path: "source.mkv", length, createReadStream: options => fs.createReadStream(video, options) }] } };
  const torrent = { infoHashV1: "a".repeat(40), files: [{ path: "source.mkv", size: length }] };
  const records = new Map();
  const redis = { get: async key => records.get(key), set: async (key, value) => records.set(key, value), lease: async (key, value, op) => {
    if (records.get(key) !== value) {
      return 0;
    }
    if (op === "release") {
      records.delete(key);
    }
    return 1;
  } };
  const original = fs.readFileSync(path.join(__dirname, "../../lib/media/torrent-stream.js"), "utf8");
  const source = original.replace(/async function createSession\(torrent, item\) \{[\s\S]*?(?=async function getSession\()/, "const createSession = async () => fixtureSession;\n");
  const moduleUnderTest = { exports: {} };
  vm.compileFunction(source, ["require", "module", "fixtureSession"])(name => {
    if (name === "../broker") {
      return { getMethods: () => redis };
    }
    if (name === "../redis-lease") {
      return { withLease: (_key, action) => action() };
    }
    if (name === "./torrent-hls") {
      return { serveCompatible };
    }
    return name.startsWith("../") ? {} : require(name);
  }, moduleUnderTest, session);
  const server = http.createServer((req, res) => {
    res.status = code => {
      res.statusCode = code; return res;
    };
    res.json = value => res.end(JSON.stringify(value));
    moduleUnderTest.exports.serveTorrent(req, res, { torrent, item: {} }, 0, req.url.slice(1)).catch(error => res.destroy(error));
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const manifest = await fetch(`${base}/hls.m3u8`);
    const text = await manifest.text();
    expect(manifest.status).toBe(200); expect(text).toContain("segment/2.ts"); expect(text).toContain("#EXT-X-ENDLIST");
    // Seek ahead first, then back to the beginning. Each section starts with
    // codec headers and can decode without downloading earlier sections.
    for (const part of [2, 0]) {
      const response = await fetch(`${base}/segment/${part}.ts`);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200); expect(bytes[0]).toBe(0x47);
      const decoded = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", "pipe:0"], { input: bytes, encoding: "utf8", timeout: 15000 });
      expect(decoded.status).toBe(0);
      expect(JSON.parse(decoded.stdout).streams.map(stream => stream.codec_name)).toEqual(expect.arrayContaining(["h264", "aac"]));
    }
  }
  finally {
    controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await session.onClose?.();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("hobbyfiles-stream-hls-test-")) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}, 120000);
