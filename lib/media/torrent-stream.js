"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomUUID, randomBytes } = require("node:crypto");
const { validPeer, discoverPeers, peerMetadata, announceTracker } = require("../torrent-network");
const { decode, encode } = require("../torrent-bencode");
const { parseTorrent } = require("../torrent");
const { peerCandidates } = require("../torrent-discovery");

async function playbackMetadata(contacts, torrent, peerId, { lookup = peerMetadata, signal = AbortSignal.timeout(20000) } = {}) {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let next = 0;
  const attempt = async () => {
    while (next < contacts.length && !combined.aborted) {
      try {
        const result = await lookup(contacts[next++], torrent, { signal: combined, includeBuffer: true, peerId });
        if (result.metainfo) {
          return result.metainfo;
        }
      }
      catch (_) { /* A failed peer frees its slot for the next public contact. */ }
    }
    throw new Error("No peers made this video's metadata available. Try again shortly or upload its .torrent file.");
  };
  try {
    return await Promise.any(Array.from({ length: Math.min(4, contacts.length) }, attempt));
  }
  catch (_) {
    throw new Error("No peers made this video's metadata available. Try again shortly or upload its .torrent file.");
  }
  finally {
    controller.abort();
  }
}

const MAX_TORRENT_BYTES = 8 * 1024 ** 3;
const MAX_CACHE_BYTES = 4 * 1024 ** 3;
const MAX_PIECE_BYTES = 4 * 1024 ** 2;
const sessions = new Map();
const pending = new Map();

/** Flat, private piece files: torrent names never become filesystem paths. */
class PieceStore {
  constructor(pieceLength, options) {
    this.pieceLength = pieceLength; this.chunkLength = pieceLength; this.options = options; this.written = new Set(); this.bytes = 0; this.closed = false;
    this.dir = options.path;
    this.valid = pieceLength > 0 && pieceLength <= MAX_PIECE_BYTES && options.length > 0 && options.length <= MAX_TORRENT_BYTES;
  }

  put(index, buffer, callback) {
    if (!this.valid || this.closed || !Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(this.options.length / this.pieceLength) || buffer.length > this.pieceLength) {
      queueMicrotask(() => callback(new Error("Torrent exceeds the streaming limits"))); return;
    }
    if (!this.written.has(index)) {
      this.written.add(index); this.bytes += buffer.length;
    }
    if (this.bytes > MAX_CACHE_BYTES) {
      queueMicrotask(() => callback(new Error("Streaming cache is full"))); return;
    }
    fs.writeFile(path.join(this.dir, String(index)), buffer, { mode: 0o600 }, callback);
  }

  get(index, options, callback) {
    if (typeof options === "function") {
      callback = options; options = {};
    }
    options ||= {};
    if (this.closed || !Number.isSafeInteger(index) || index < 0 || !this.written.has(index)) {
      queueMicrotask(() => callback(new Error("Piece is not available"))); return;
    }
    fs.readFile(path.join(this.dir, String(index)), (error, buffer) => {
      if (error) {
        callback(error); return;
      }
      const start = options.offset || 0;
      callback(null, buffer.subarray(start, options.length === undefined ? undefined : start + options.length));
    });
  }

  close(callback) {
    this.closed = true; queueMicrotask(() => callback?.(null));
  }

  destroy(callback) {
    this.close(callback);
  }
}

function parseRange(header, length) {
  if (!header) {
    return { start: 0, end: length - 1, partial: false };
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) {
    return null;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && start < length ? { start, end, partial: true } : null;
}

async function claimSlot() {
  const redis = require("../broker").getMethods("set", "lease");

  const owner = randomUUID();
  for (let i = 0; i < 2; i++) {
    const key = `lock:torrent-stream:${i}`;
    if (await redis.set(key, owner, "NX", "PX", 30000) === "OK") {
      return { redis, owner, key };
    }
  }
  throw new Error("Both streaming slots are in use. Close another video or try again shortly.");
}

async function createSession(torrent, item) {
  if (!torrent?.infoHashV1 || torrent.private || torrent.totalSize > MAX_TORRENT_BYTES) {
    throw new Error("This torrent cannot stream here. Use a public v1 torrent smaller than 8 GiB, or upload the video file.");
  }
  const WebTorrent = await require("./torrent-runtime").loadTorrentRuntime();
  const slot = await claimSlot();
  const peerId = Buffer.concat([Buffer.from("-DF0001-"), randomBytes(12)]);
  const trackers = (Array.isArray(torrent.trackers) ? torrent.trackers : []).filter(raw => /^(udp|https?):\/\//i.test(raw)).slice(0, 4);
  const announced = new Set();
  const abort = new AbortController();
  let dir; let client; let cleanupTimer; let peerTimer; let closed = false;
  const session = { torrent: null, touched: Date.now(), created: Date.now(), active: 0, error: null, close: null, onClose: null, onHeartbeat: null, dir: null, signal: abort.signal };
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true; abort.abort(); clearInterval(heartbeat); clearInterval(cleanupTimer); clearInterval(peerTimer); sessions.delete(torrent.infoHashV1);
    await session.onClose?.().catch(() => {});
    if (client && !client.destroyed) {
      await new Promise(resolve => client.destroy(() => resolve()));
    }
    await Promise.allSettled([...announced].map(raw => announceTracker(raw, torrent.infoHashV1, peerId, { event: "stopped", signal: AbortSignal.timeout(2000), downloaded: session.torrent?.downloaded || 0, left: Math.max(0, (torrent.totalSize || 1) - (session.torrent?.downloaded || 0)) })));
    // mkdtemp owns this exact absolute directory; validate before recursive cleanup.
    if (dir && path.dirname(dir) === os.tmpdir() && /^(?:hobbyfiles|dicefiles)-stream-/.test(path.basename(dir))) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => console.warn("An abandoned streaming cache needs operator cleanup."));
    }
    await slot.redis.lease(slot.key, slot.owner, "release").catch(() => {});
  };
  session.close = close;
  const heartbeat = setInterval(async () => {
    try {
      if (Number(await slot.redis.lease(slot.key, slot.owner, 30000)) !== 1) {
        await close();
      }
      await session.onHeartbeat?.();
    }
    catch (_) {
      await close().catch(() => {});
    }
  }, 10000); heartbeat.unref();
  try {
    const [dht, reports] = await Promise.all([
      discoverPeers(torrent.infoHashV1, AbortSignal.timeout(7000)).catch(() => []),
      Promise.allSettled(trackers.map(async raw => {
        const report = await announceTracker(raw, torrent.infoHashV1, peerId, { left: torrent.totalSize || 1 });
        announced.add(raw); return report.peers;
      })),
    ]);
    const contacts = peerCandidates([...reports.filter(result => result.status === "fulfilled").map(result => result.value), dht]);
    let source;
    if (item.storage && /\.torrent$/i.test(item.name)) {
      const stat = await fs.promises.stat(item.storage.full);
      if (stat.size > 2 * 1024 * 1024) {
        throw new Error("This torrent metadata is too large. Use a smaller torrent file.");
      }
      const bytes = await fs.promises.readFile(item.storage.full);
      parseTorrent(bytes); source = encode({ info: decode(bytes).value.info });
    }
    else {
      for (const url of (torrent.exactSources || []).slice(0, 2)) {
        try {
          const result = await require("../link-metadata").fetchTorrent(url);
          if (result.torrent.infoHashV1 === torrent.infoHashV1) {
            source = encode({ info: decode(result.buffer).value.info }); break;
          }
        }
        catch (_) { /* Verified public peers remain an alternative. */ }
      }
      if (!source) {
        source = await playbackMetadata(contacts, torrent, peerId, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      }
    }
    if (!source) {
      throw new Error("No peers made this video available. Try again later or upload the video file.");
    }
    const verified = parseTorrent(source);
    if (verified.infoHashV1 !== torrent.infoHashV1 || verified.private || verified.totalSize > MAX_TORRENT_BYTES || verified.pieceLength > MAX_PIECE_BYTES || verified.pieceCount > 65536) {
      throw new Error("This torrent exceeds streaming limits or does not match. Upload its video file instead.");
    }
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hobbyfiles-stream-"));
    session.dir = dir;
    client = new WebTorrent({ peerId, dht: false, tracker: false, lsd: false, utPex: false, natUpnp: false, natPmp: false, utp: false, webSeeds: false, maxConns: 12, downloadLimit: 8 * 1024 * 1024 });
    // Every outgoing peer must be a validated literal public address. Tracker,
    // web-seed, xs, local discovery, PEX and built-in DHT paths are disabled.
    client.blocked = { contains: host => !validPeer({ host, port: 6881 }) };
    client.on("error", () => {
      session.error = "The torrent connection stopped. Reopen the video to try again."; close().catch(() => {});
    });
    client.on("listening", () => client._connPool?.tcpServer?.on("connection", socket => socket.destroy()));
    cleanupTimer = setInterval(() => {
      if (!session.active && Date.now() - session.touched > 90000 || Date.now() - session.created > 4 * 3600000) {
        close().catch(() => {});
      }
    }, 15000); cleanupTimer.unref();
    const wt = client.add(source, { path: dir, store: PieceStore, storeCacheSlots: 0, deselect: true, uploads: false, destroyStoreOnDestroy: true, strategy: "sequential" });
    session.torrent = wt;
    let discovering = false;
    const addContacts = peers => {
      for (const peer of peers) {
        if (!closed && validPeer(peer)) {
          wt.addPeer(peer.host.includes(":") ? `[${peer.host}]:${peer.port}` : `${peer.host}:${peer.port}`);
        }
      }
    };
    // Public DHT contacts change. Refresh only while someone is actively
    // streaming; this is independent of tracker-only background monitoring.
    peerTimer = setInterval(async () => {
      if (closed || discovering || !session.active || wt.numPeers >= 6) {
        return;
      }
      discovering = true;
      try {
        addContacts(await discoverPeers(torrent.infoHashV1, AbortSignal.timeout(7000)));
      }
      catch (_) { /* Existing peers or the bounded stream timeout remain. */ }
      finally {
        discovering = false;
      }
    }, 30000); peerTimer.unref();
    wt.on("error", () => {
      session.error = "The torrent could not be streamed within this server's limits. Try another source or upload the video."; close().catch(() => {});
    });
    wt.once("infoHash", async () => {
      try {
        addContacts(contacts);
      }
      catch (_) { /* The ready timeout gives the visitor a recovery message. */ }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No peers made this video available. Try again later or upload the video file.")), 20000);
      const finish = error => {
        clearTimeout(timer); wt.removeListener("error", fail); error ? reject(error) : resolve();
      };
      const fail = () => finish(new Error("The torrent could not be opened. Check its peers or upload the video file."));
      wt.once("error", fail);
      wt.once("ready", () => {
        if (wt.length > MAX_TORRENT_BYTES || wt.pieceLength > MAX_PIECE_BYTES || wt.private) {
          finish(new Error("This torrent exceeds streaming limits. Upload its video file instead.")); return;
        }
        finish();
      });
    });
    if (closed) {
      throw new Error("The torrent streaming slot expired. Reopen the video to try again.");
    }
    sessions.set(torrent.infoHashV1, session);
    return session;
  }
  catch (error) {
    await close(); throw error;
  }
}

async function getSession(torrent, item) {
  const hash = torrent?.infoHashV1;
  if (sessions.has(hash)) {
    const session = sessions.get(hash); session.touched = Date.now(); return session;
  }
  if (!pending.has(hash)) {
    const promise = createSession(torrent, item).finally(() => pending.delete(hash)); pending.set(hash, promise);
  }
  return pending.get(hash);
}

async function serveSession(req, res, session, torrent, index) {
  const file = session.torrent.files[index];
  const expected = torrent.files[index];
  const expectedPath = expected?.path || expected?.name;
  const samePath = file && (file.path === expectedPath || file.path === `${session.torrent.name}/${expectedPath}`);
  if (!file || file.length > MAX_CACHE_BYTES || file.length !== expected?.size || !samePath || !/\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts)$/i.test(file.name)) {
    throw new Error("This video cannot stream here. Choose a video smaller than 4 GiB or upload it directly.");
  }
  const range = parseRange(req.headers.range, file.length);
  res.setHeader("Accept-Ranges", "bytes");
  if (!range) {
    res.statusCode = 416; res.setHeader("Content-Range", `bytes */${file.length}`); res.end(); return;
  }
  const mime = /\.webm$/i.test(file.name) ? "video/webm" : /\.mkv$/i.test(file.name) ? "video/x-matroska" : /\.(ts|m2ts)$/i.test(file.name) ? "video/mp2t" : /\.avi$/i.test(file.name) ? "video/x-msvideo" : "video/mp4";
  res.statusCode = range.partial ? 206 : 200; res.setHeader("Content-Type", mime); res.setHeader("Content-Length", range.end - range.start + 1);
  if (range.partial) {
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.length}`);
  }
  if (req.method === "HEAD") {
    res.end(); return;
  }
  const stream = file.createReadStream({ start: range.start, end: range.end });
  session.active++; let done = false;
  const timeout = setTimeout(() => {
    stream.destroy(); res.destroy();
  }, 90000);
  const touch = () => {
    session.touched = Date.now(); timeout.refresh();
  };
  const finish = () => {
    if (done) {
      return;
    }
    done = true; clearTimeout(timeout); session.active--; session.touched = Date.now(); stream.destroy();
  };
  stream.on("data", touch); stream.on("error", () => res.destroy()); res.once("close", finish); stream.pipe(res);
}

function validRelay(value) {
  if (!value || !/^[\da-f-]{36}$/.test(value.secret || "")) {
    return false;
  }
  if (process.platform === "win32") {
    return /^\\\\\.\\pipe\\(?:hobbyfiles|dicefiles)-stream-[\da-f-]{36}$/.test(value.socket || "");
  }
  return path.dirname(path.dirname(value.socket || "")) === os.tmpdir() && /^(?:hobbyfiles|dicefiles)-stream-[\w-]+$/.test(path.basename(path.dirname(value.socket || ""))) && path.basename(value.socket || "") === "relay.sock";
}

async function startRelay(session, torrent, registryKey, redis) {
  const secret = randomUUID();
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\hobbyfiles-stream-${secret}` : path.join(session.dir, "relay.sock");
  const connections = new Set();
  const server = http.createServer((req, res) => {
    const match = /^\/(\d{1,4})(?:\/(hls\.m3u8|segment\/\d{1,4}\.ts))?$/.exec(req.url);
    if (req.headers.authorization !== `Bearer ${secret}` || !["GET", "HEAD"].includes(req.method) || !match) {
      res.writeHead(403); res.end(); return;
    }
    session.touched = Date.now();
    const index = Number(match[1]);
    const file = session.torrent.files[index];
    const expected = torrent.files[index];
    const valid = file && expected && file.length <= MAX_CACHE_BYTES && file.length === expected.size && (file.path === (expected.path || expected.name) || file.path === `${session.torrent.name}/${expected.path || expected.name}`) && /\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts)$/i.test(file.name);
    const result = !valid ? Promise.reject(new Error("This video cannot stream here. Choose a supported video smaller than 4 GiB.")) : match[2] ? require("./torrent-hls").serveCompatible(req, res, session, { socket, secret }, index, match[2]) : serveSession(req, res, session, torrent, index);
    result.catch(error => {
      if (!res.headersSent) {
        res.writeHead(error.status || 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: /^(This|The video|The torrent)/.test(error.message || "") ? error.message : "The video could not be prepared. Check the server's video tools and try again." }));
      }
      else {
        res.destroy();
      }
    });
  });
  server.on("connection", connection => {
    connections.add(connection); connection.once("close", () => connections.delete(connection));
  });
  server.on("error", () => session.close().catch(() => {}));
  const record = JSON.stringify({ socket, secret });
  session.onClose = async () => {
    connections.forEach(connection => connection.destroy());
    await new Promise(resolve => server.close(() => resolve()));
    await redis.lease(registryKey, record, "release");
  };
  session.onHeartbeat = async () => {
    if (Number(await redis.lease(registryKey, record, 30000)) !== 1) {
      throw new Error("Streaming relay expired");
    }
  };
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(socket, resolve);
  });
  if (process.platform !== "win32") {
    await fs.promises.chmod(socket, 0o600);
  }
  await redis.set(registryKey, record, "PX", 30000);
  return { socket, secret };
}

async function relayFor(torrent, item) {
  const { createHash } = require("node:crypto");

  const identity = createHash("sha256").update(`${os.hostname()}:${os.tmpdir()}:${torrent.infoHashV1}`).digest("hex");
  const registryKey = `torrent-relay:${identity}`;
  const redis = require("../broker").getMethods("get", "set", "lease");

  return require("../redis-lease").withLease(`lock:${registryKey}`, async () => {
    let existing;
    try {
      existing = JSON.parse(await redis.get(registryKey));
    }
    catch (_) { /* An absent or malformed private registry entry is replaced. */ }
    if (validRelay(existing) && (process.platform === "win32" || fs.existsSync(existing.socket))) {
      return existing;
    }
    const session = await getSession(torrent, item);
    return startRelay(session, torrent, registryKey, redis);
  }, { waitMs: 30000, ttlMs: 60000 });
}

async function serveTorrent(req, res, { torrent, item }, index, resource = "") {
  if (resource && !/^(hls\.m3u8|segment\/\d{1,4}\.ts)$/.test(resource)) {
    throw new Error("This video section is invalid. Reopen the player and try again.");
  }
  const relay = await relayFor(torrent, item);
  if (req.destroyed || res.destroyed) {
    return;
  }
  const headers = { authorization: `Bearer ${relay.secret}` };
  if (req.headers.range) {
    headers.range = req.headers.range;
  }
  const upstream = http.request({ socketPath: relay.socket, path: `/${index}${resource ? `/${resource}` : ""}`, method: req.method, headers }, source => {
    res.status(source.statusCode);
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      if (source.headers[name]) {
        res.setHeader(name, source.headers[name]);
      }
    }
    source.on("error", () => res.destroy()); source.pipe(res);
  });
  upstream.setTimeout(resource ? 150000 : 90000, () => upstream.destroy());
  upstream.on("error", error => {
    console.warn("Torrent stream relay connection failed", error.code || "connection closed");
    if (!res.headersSent) {
      res.status(503).json({ error: "The video stream stopped. Reopen the video to reconnect, or try again shortly." });
    }
    else {
      res.destroy();
    }
  });
  res.once("close", () => upstream.destroy()); upstream.end();
}

module.exports = { PieceStore, parseRange, playbackMetadata, getSession, serveTorrent, relayFor, validRelay, MAX_CACHE_BYTES, MAX_TORRENT_BYTES };
