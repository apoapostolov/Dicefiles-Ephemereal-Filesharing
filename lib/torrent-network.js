"use strict";

const dgram = require("node:dgram");
const net = require("node:net");
const { randomBytes, createHash } = require("node:crypto");
const { decode, encode } = require("./torrent-bencode");
const { isPrivateIp, resolvePublicAddress, abortable, guardedFetch } = require("./net-guard");
const { parseTorrent, MAX_TORRENT_BYTES } = require("./torrent");

const BOOTSTRAP = ["router.bittorrent.com", "router.utorrent.com", "dht.transmissionbt.com"];

function validPeer(peer) {
  if (!peer || !net.isIP(peer.host) || isPrivateIp(peer.host) || !Number.isInteger(peer.port) || peer.port < 1 || peer.port > 65535) {
    return false;
  }
  if (net.isIP(peer.host) === 4) {
    const [a, b] = peer.host.split(".").map(Number);
    return a < 224 && !(a === 198 && (b === 18 || b === 19));
  }
  // Contacts must be global unicast, never local multicast or deprecated
  // IPv4-compatible IPv6 addresses that could bypass an IPv4 range check.
  return /^[23][\da-f]{3}:/i.test(peer.host);
}

async function udpRequest(host, port, packet, { signal, resolve = resolvePublicAddress, socketFactory = dgram.createSocket } = {}) {
  signal?.throwIfAborted();
  const pinned = await abortable(resolve(host), signal || AbortSignal.timeout(3000));
  signal?.throwIfAborted();
  if (!validPeer({ host: pinned.address, port }) || packet.length > 4096) {
    throw new Error("Invalid tracker destination");
  }
  return new Promise((fulfill, reject) => {
    const socket = socketFactory(pinned.family === 6 ? "udp6" : "udp4");
    let done = false;
    const finish = (error, data) => {
      if (done) {
        return;
      }
      done = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      try {
        socket.close();
      }
      catch (_) { /* The socket may not have bound before cancellation. */ }
      error ? reject(error) : fulfill(data);
    };
    const cancel = () => finish(new Error("Discovery cancelled"));
    const timer = setTimeout(() => finish(new Error("Tracker timed out")), 1800);
    socket.once("error", error => finish(error));
    socket.once("message", data => finish(data.length > 65536 ? new Error("Tracker response too large") : null, data));
    signal?.addEventListener("abort", cancel, { once: true });
    // A connected UDP socket accepts responses only from the pinned endpoint.
    socket.connect(port, pinned.address, () => {
      if (!done) {
        socket.send(packet, error => error && finish(error));
      }
    });
  });
}

function compactPeer(data, offset = 0) {
  if (!Buffer.isBuffer(data) || data.length < offset + 6) {
    return null;
  }
  const peer = { host: [...data.subarray(offset, offset + 4)].join("."), port: data.readUInt16BE(offset + 4) };
  return validPeer(peer) ? peer : null;
}

function compactPeers(data, family = 4, maximum = 24) {
  if (!Buffer.isBuffer(data)) {
    return [];
  }
  const stride = family === 6 ? 18 : 6; const peers = [];
  for (let offset = 0; offset + stride <= data.length && peers.length < maximum; offset += stride) {
    const peer = family === 4 ? compactPeer(data, offset) : { host: Array.from({ length: 8 }, (_, i) => data.readUInt16BE(offset + i * 2).toString(16)).join(":"), port: data.readUInt16BE(offset + 16) };
    if (validPeer(peer)) {
      peers.push(peer);
    }
  }
  return peers;
}

/** Bounded peer discovery for playback or unresolved magnets; monitoring uses scrapeTracker. */
async function announceTracker(raw, hash, peerId, { signal = AbortSignal.timeout(5000), event = "started", left = 1, downloaded = 0, port = 6881, udp = udpRequest, resolve = resolvePublicAddress, fetcher = guardedFetch } = {}) {
  const url = new URL(raw);
  if (raw.length > 2048 || url.username || url.password || !/^[a-f\d]{40}$/i.test(hash) || !Buffer.isBuffer(peerId) || peerId.length !== 20 || !["started", "stopped"].includes(event) || !Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(downloaded) || downloaded < 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid playback tracker request");
  }
  const want = event === "stopped" ? 0 : 24;
  if (url.protocol === "udp:") {
    const pinned = await abortable(resolve(url.hostname), signal);
    if (!validPeer({ host: pinned.address, port: Number(url.port || 80) })) {
      throw new Error("Invalid tracker destination");
    }
    const transaction = randomBytes(4); const connect = Buffer.alloc(16);
    connect.writeBigUInt64BE(0x41727101980n); transaction.copy(connect, 12);
    const connection = await udp(pinned.address, Number(url.port || 80), connect, { signal });
    if (connection.length < 16 || connection.readUInt32BE(0) !== 0 || !connection.subarray(4, 8).equals(transaction)) {
      throw new Error("Tracker did not accept the playback connection");
    }
    const packet = Buffer.alloc(98);
    connection.copy(packet, 0, 8, 16); packet.writeUInt32BE(1, 8); transaction.copy(packet, 12);
    Buffer.from(hash, "hex").copy(packet, 16); peerId.copy(packet, 36);
    packet.writeBigUInt64BE(BigInt(downloaded), 56); packet.writeBigUInt64BE(BigInt(left), 64);
    packet.writeUInt32BE(event === "started" ? 2 : 3, 80); randomBytes(4).copy(packet, 88); packet.writeInt32BE(want, 92); packet.writeUInt16BE(port, 96);
    const response = await udp(pinned.address, Number(url.port || 80), packet, { signal });
    if (response.length < 20 || response.readUInt32BE(0) !== 1 || !response.subarray(4, 8).equals(transaction)) {
      throw new Error("Tracker playback peers are unavailable");
    }
    return { interval: response.readUInt32BE(8), peers: want ? compactPeers(response.subarray(20), pinned.family) : [] };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported playback tracker protocol");
  }
  url.hash = "";
  for (const [key, value] of Object.entries({ port, downloaded, uploaded: 0, left, compact: 1, numwant: want, event })) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.delete("info_hash"); url.searchParams.delete("peer_id");
  const binary = bytes => [...bytes].map(byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
  const target = `${url.href}${url.search ? "&" : "?"}info_hash=${binary(Buffer.from(hash, "hex"))}&peer_id=${binary(peerId)}`;
  const response = await fetcher(target, {}, { signal, maxBytes: 65536, timeoutMs: 4000, maxRedirects: 0 });
  if (!response.ok) {
    throw new Error("Tracker playback peers are unavailable");
  }
  const data = decode(Buffer.from(await response.arrayBuffer()), { maxBytes: 65536 }).value;
  if (data["failure reason"]) {
    throw new Error("Tracker playback peers are unavailable");
  }
  return { interval: Number(data.interval) || 1800, peers: want ? [...compactPeers(data.peers), ...compactPeers(data.peers6, 6)].slice(0, 24) : [] };
}

async function discoverPeers(hash, signal, options = {}) {
  const query = options.udpRequest || udpRequest;
  const nodeId = randomBytes(20);
  const target = Buffer.from(hash, "hex");
  const seen = new Set(); const peers = new Map();
  const queue = BOOTSTRAP.map(host => ({ host, port: 6881, distance: Buffer.alloc(20, 255) }));
  let queried = 0;
  while (queue.length && queried < 36 && peers.size < 12 && !signal.aborted) {
    const batch = queue.splice(0, Math.min(4, 36 - queried));
    await Promise.allSettled(batch.map(async node => {
      const key = `${node.host}:${node.port}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key); queried++;
      const transaction = randomBytes(4);
      const response = await query(node.host, node.port, encode({ a: { id: nodeId, info_hash: target }, q: "get_peers", t: transaction, y: "q" }), { signal });
      const message = decode(response, { maxBytes: 65536 }).value;
      if (!Buffer.isBuffer(message.t) || !message.t.equals(transaction) || message.y?.toString() !== "r") {
        return;
      }
      for (const value of (Array.isArray(message.r?.values) ? message.r.values : []).slice(0, 64)) {
        const peer = compactPeer(value);
        if (peer && peers.size < 24) {
          peers.set(`${peer.host}:${peer.port}`, peer);
        }
      }
      const nodes = message.r?.nodes;
      if (Buffer.isBuffer(nodes)) {
        for (let offset = 0; offset + 26 <= nodes.length && queue.length < 64; offset += 26) {
          const peer = compactPeer(nodes, offset + 20);
          if (peer && !seen.has(`${peer.host}:${peer.port}`)) {
            const distance = Buffer.from(nodes.subarray(offset, offset + 20));
            for (let i = 0; i < 20; i++) {
              distance[i] ^= target[i];
            }
            queue.push({ ...peer, distance });
          }
        }
      }
    }));
    queue.sort((a, b) => Buffer.compare(a.distance, b.distance));
  }
  return [...peers.values()].slice(0, 24);
}

async function scrapeTracker(raw, hash, signal, options = {}) {
  const url = new URL(raw);
  if (raw.length > 2048 || url.username || url.password) {
    throw new Error("Unsupported tracker address");
  }
  const infoHash = Buffer.from(hash, "hex");
  if (url.protocol === "udp:") {
    const request = options.udpRequest || udpRequest;
    const transaction = randomBytes(4);
    const connect = Buffer.alloc(16);
    connect.writeBigUInt64BE(0x41727101980n); transaction.copy(connect, 12);
    const response = await request(url.hostname, Number(url.port || 80), connect, { signal });
    if (response.length !== 16 || response.readUInt32BE(0) !== 0 || !response.subarray(4, 8).equals(transaction)) {
      throw new Error("Tracker did not accept the connection");
    }
    const scrape = Buffer.alloc(36);
    response.copy(scrape, 0, 8, 16); scrape.writeUInt32BE(2, 8); transaction.copy(scrape, 12); infoHash.copy(scrape, 16);
    const result = await request(url.hostname, Number(url.port || 80), scrape, { signal });
    if (result.length !== 20 || result.readUInt32BE(0) !== 2 || !result.subarray(4, 8).equals(transaction)) {
      throw new Error("Tracker availability is unavailable");
    }
    return { seeders: result.readUInt32BE(8), completed: result.readUInt32BE(12), leechers: result.readUInt32BE(16) };
  }
  if (!["http:", "https:"].includes(url.protocol) || !/\/announce[^/]*$/.test(url.pathname)) {
    throw new Error("This tracker does not expose a supported scrape endpoint");
  }
  url.pathname = url.pathname.replace(/\/announce([^/]*)$/, "/scrape$1");
  url.searchParams.delete("info_hash");
  const encodedHash = [...infoHash].map(byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
  const target = `${url.href}${url.search ? "&" : "?"}info_hash=${encodedHash}`;
  const response = await (options.fetcher || guardedFetch)(target, {}, { signal, maxBytes: 65536, timeoutMs: 4000, maxRedirects: 1 });
  if (!response.ok) {
    throw new Error("Tracker availability is unavailable");
  }
  const message = decode(Buffer.from(await response.arrayBuffer()), { maxBytes: 65536 }).value;
  const row = message.files?.[infoHash.toString("latin1")];
  if (!row || ![row.complete, row.incomplete, row.downloaded ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error("Tracker did not report this torrent");
  }
  return { seeders: row.complete, leechers: row.incomplete, completed: row.downloaded ?? null };
}

function peerMetadata(peer, torrent, { signal, connect = net.createConnection, allowPeer = validPeer, includeBuffer = false, peerId = randomBytes(20) } = {}) {
  if (signal?.aborted) {
    return Promise.reject(new Error("Metadata lookup cancelled"));
  }
  if (!allowPeer(peer) || !Buffer.isBuffer(peerId) || peerId.length !== 20) {
    return Promise.reject(new Error("Peer address is blocked"));
  }
  const hash = Buffer.from(torrent.infoHashV1 || torrent.infoHashV2.slice(0, 40), "hex");
  return new Promise((fulfill, reject) => {
    const socket = connect({ host: peer.host, port: peer.port });
    let finished = false; let buffer = Buffer.alloc(0); let bytes = 0; let handshake = false; let timer;
    let extension = 0; let size = 0; let received = 0; let next = 0; let outstanding = 0;
    const blocks = [];
    const finish = (error, result) => {
      if (finished) {
        return;
      }
      finished = true; clearTimeout(timer); clearTimeout(lifetime); signal?.removeEventListener("abort", cancel); socket.destroy();
      error ? reject(error) : fulfill(result);
    };
    const cancel = () => finish(new Error("Metadata lookup cancelled"));
    timer = setTimeout(() => finish(new Error("Peer connection timed out")), 2000);
    const lifetime = setTimeout(() => finish(new Error("Peer metadata timed out")), 15000);
    const send = (id, body) => {
      const payload = Buffer.concat([Buffer.from([20, id]), body]);
      const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
      socket.write(Buffer.concat([header, payload]));
    };
    const request = () => {
      while (!finished && outstanding < 2 && next < Math.ceil(size / 16384)) {
        send(extension, encode({ msg_type: 0, piece: next++ })); outstanding++;
      }
    };
    socket.once("connect", () => {
      if (signal?.aborted) {
        return cancel();
      }
      clearTimeout(timer); timer = setTimeout(() => finish(new Error("Peer metadata timed out")), 3500);
      const hello = Buffer.alloc(68);
      hello[0] = 19; hello.write("BitTorrent protocol", 1); hello[25] = 0x10;
      hash.copy(hello, 28); peerId.copy(hello, 48); socket.write(hello);
    });
    socket.on("data", chunk => {
      try {
        bytes += chunk.length;
        if (bytes > MAX_TORRENT_BYTES + 256 * 1024) {
          throw new Error("Peer metadata exceeds its limit");
        }
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshake) {
          if (buffer.length < 68) {
            return;
          }
          if (buffer[0] !== 19 || buffer.subarray(1, 20).toString() !== "BitTorrent protocol" || !(buffer[25] & 0x10) || !buffer.subarray(28, 48).equals(hash)) {
            throw new Error("Peer does not support this torrent's metadata");
          }
          buffer = buffer.subarray(68); handshake = true;
          send(0, encode({ m: { ut_metadata: 1 } }));
        }
        while (buffer.length >= 4 && !finished) {
          const length = buffer.readUInt32BE(0);
          if (length > 128 * 1024) {
            throw new Error("Peer message exceeds its limit");
          }
          if (buffer.length < length + 4) {
            return;
          }
          const frame = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
          if (frame.length < 2 || frame[0] !== 20) {
            continue;
          }
          if (frame[1] === 0) {
            if (size) {
              continue;
            }
            const message = decode(frame.subarray(2), { maxBytes: 65536 }).value;
            size = message.metadata_size; extension = message.m?.ut_metadata;
            if (!Number.isInteger(size) || size < 1 || size > MAX_TORRENT_BYTES || !Number.isInteger(extension) || extension < 1 || extension > 255) {
              throw new Error("Peer metadata is unavailable or too large");
            }
            timer.refresh();
            request(); continue;
          }
          if (frame[1] !== 1 || !size) {
            continue;
          }
          const { value: header, bytes: used } = decode(frame.subarray(2), { prefix: true, maxBytes: 128 * 1024 });
          if (header.msg_type === 2) {
            throw new Error("Peer declined the metadata request");
          }
          if (header.msg_type !== 1) {
            continue;
          }
          const {piece} = header; const data = frame.subarray(2 + used);
          if (!Number.isInteger(piece) || piece < 0 || piece >= next || header.total_size !== size || data.length !== Math.min(16384, size - piece * 16384)) {
            throw new Error("Peer sent invalid metadata");
          }
          if (!blocks[piece]) {
            blocks[piece] = Buffer.from(data); received += data.length; outstanding--; timer.refresh();
          }
          if (received === size) {
            const info = Buffer.concat(blocks);
            if (torrent.infoHashV1 && createHash("sha1").update(info).digest("hex") !== torrent.infoHashV1 || torrent.infoHashV2 && createHash("sha256").update(info).digest("hex") !== torrent.infoHashV2) {
              throw new Error("Peer metadata does not match this magnet");
            }
            const metainfo = Buffer.concat([Buffer.from("d4:info"), info, Buffer.from("e")]);
            const result = parseTorrent(metainfo);
            if (includeBuffer) {
              result.metainfo = metainfo;
            }
            finish(null, result); return;
          }
          request();
        }
      }
      catch (error) {
        finish(error);
      }
    });
    socket.once("error", error => finish(error));
    socket.once("close", () => finish(new Error("Peer closed before metadata was available")));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
    }
    // This client never sends interested, request-piece, announce, or payload data.
  });
}

module.exports = { validPeer, compactPeer, compactPeers, udpRequest, discoverPeers, scrapeTracker, announceTracker, peerMetadata };
