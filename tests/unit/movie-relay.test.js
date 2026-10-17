"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const vm = require("node:vm");
const { Readable } = require("node:stream");

test("separate HTTP workers share one authenticated torrent relay and retain byte ranges", async () => {
  const records = new Map(); let tail = Promise.resolve();
  const redis = { get: async key => records.get(key), set: async (key, value) => records.set(key, value), lease: async (key, value, op) => {
    if (records.get(key) !== value) {
      return 0;
    }
    if (op === "release") {
      records.delete(key);
    }
    return 1;
  } };
  const lease = (_key, action) => {
    const run = tail.then(action); tail = run.catch(() => {}); return run;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hobbyfiles-stream-relay-test-"));
  const payload = Buffer.alloc(100, 7);
  const session = { dir, active: 0, touched: Date.now(), torrent: { name: "Example", files: [{ name: "video.mp4", path: "Example/video.mp4", length: payload.length, createReadStream: ({ start, end }) => Readable.from([payload.subarray(start, end + 1)]) }] } };
  const createSession = jest.fn(async () => session);
  const source = fs.readFileSync(path.join(__dirname, "../../lib/media/torrent-stream.js"), "utf8").replace(/async function createSession\(torrent, item\) \{[\s\S]*?(?=async function getSession\()/, "const createSession = sessionFactory;\n");
  const load = () => {
    const module = { exports: {} };
    const requireMock = name => {
      if (name === "../broker") {
        return { getMethods: () => redis };
      }
      if (name === "../redis-lease") {
        return { withLease: lease };
      }
      if (name.startsWith("../")) {
        return {};
      }
      return require(name);
    };
    vm.compileFunction(source, ["require", "module", "sessionFactory", "process", "Buffer"])(requireMock, module, createSession, process, Buffer);
    return module.exports;
  };
  const workers = [load(), load()]; let requestNumber = 0;
  const torrent = { infoHashV1: "a".repeat(40), files: [{ path: "video.mp4", size: payload.length }] };
  const server = http.createServer((req, res) => {
    res.status = code => {
      res.statusCode = code; return res;
    };
    res.json = value => res.end(JSON.stringify(value));
    workers[requestNumber++ % 2].serveTorrent(req, res, { torrent, item: {} }, 0).catch(error => res.destroy(error));
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(url, { headers: { Range: "bytes=10-19" } })));
    for (const response of responses) {
      expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 10-19/100");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(payload.subarray(10, 20));
    }
    expect(createSession).toHaveBeenCalledTimes(1);
    const head = await fetch(url, { method: "HEAD", headers: { Range: "bytes=-5" } });
    expect(head.status).toBe(206); expect(head.headers.get("content-length")).toBe("5");
    const relay = JSON.parse([...records.values()][0]);
    const denied = await new Promise((resolve, reject) => {
      const request = http.get({ socketPath: relay.socket, path: "/0" }, response => {
        response.resume(); response.once("end", () => resolve(response.statusCode));
      }); request.once("error", reject);
    });
    expect(denied).toBe(403);
  }
  finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await session.onClose?.();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("hobbyfiles-stream-relay-test-")) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}, 10000);
