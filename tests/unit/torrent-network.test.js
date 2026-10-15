"use strict";

const net = require("node:net");
const { createHash } = require("node:crypto");
const { encode, decode } = require("../../lib/torrent-bencode");
const { validPeer, compactPeer, scrapeTracker, discoverPeers, peerMetadata, udpRequest } = require("../../lib/torrent-network");

const info = encode({ "name": "Public synthetic book.txt", "length": 4, "piece length": 16384, "pieces": Buffer.alloc(20, 1) });
const hash = createHash("sha1").update(info).digest("hex");
const signal = () => AbortSignal.timeout(5000);

test("bounded codec retains binary dictionary keys and prefix boundaries", () => {
  const bytes = encode({ files: new Map([[Buffer.from(hash, "hex"), { complete: 12, incomplete: 2 }]]) });
  expect(decode(bytes).value.files[Buffer.from(hash, "hex").toString("latin1")].complete).toBe(12);
  const header = encode({ piece: 0 });
  expect(decode(Buffer.concat([header, Buffer.from("payload")]), { prefix: true }).bytes).toBe(header.length);
  for (const bad of ["i01e", "i-e", "d1:ai1e1:ai2ee", "99999999:x", "letrailing"]) {
    expect(() => decode(Buffer.from(bad))).toThrow();
  }
  expect(() => decode(Buffer.alloc(10), { maxBytes: 4 })).toThrow();
});

test("peer addresses reject private, loopback, invalid and zero-port endpoints", async () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "invalid"]) {
    expect(Boolean(validPeer({ host, port: 6881 }))).toBe(false);
  }
  expect(validPeer({ host: "8.8.8.8", port: 6881 })).toBe(true);
  expect(Boolean(validPeer({ host: "8.8.8.8", port: 0 }))).toBe(false);
  expect(compactPeer(Buffer.from([127, 0, 0, 1, 26, 225]))).toBeNull();
  const socketFactory = jest.fn();
  await expect(udpRequest("127.0.0.1", 6881, Buffer.alloc(16), { signal: signal(), socketFactory })).rejects.toThrow();
  expect(socketFactory).not.toHaveBeenCalled();
});

test("HTTP scrape encodes the binary hash and reads actual reported counts", async () => {
  const fetcher = jest.fn(async () => new Response(encode({ files: new Map([[Buffer.from(hash, "hex"), { complete: 12, incomplete: 2, downloaded: 34 }]]) })));
  expect(await scrapeTracker("https://tracker.example/announce?passkey=synthetic", hash, signal(), { fetcher })).toEqual({ seeders: 12, leechers: 2, completed: 34 });
  expect(fetcher.mock.calls[0][0]).toContain("/scrape?passkey=synthetic&info_hash=%");
  await expect(scrapeTracker("file:///announce", hash, signal(), { fetcher })).rejects.toThrow();
});

test("UDP scrape validates actions and transaction IDs", async () => {
  const request = jest.fn(async (_host, _port, packet) => {
    if (packet.length === 16) {
      expect(packet.readBigUInt64BE(0)).toBe(0x41727101980n);
      const reply = Buffer.alloc(16); packet.copy(reply, 4, 12, 16); reply.writeBigUInt64BE(1234n, 8); return reply;
    }
    expect(packet.subarray(16).toString("hex")).toBe(hash);
    const reply = Buffer.alloc(20); reply.writeUInt32BE(2); packet.copy(reply, 4, 12, 16);
    reply.writeUInt32BE(7, 8); reply.writeUInt32BE(20, 12); reply.writeUInt32BE(3, 16); return reply;
  });
  expect(await scrapeTracker("udp://tracker.example:6969/announce", hash, signal(), { udpRequest: request })).toEqual({ seeders: 7, completed: 20, leechers: 3 });
  await expect(scrapeTracker("udp://tracker.example:6969", hash, signal(), { udpRequest: async () => Buffer.alloc(16, 1) })).rejects.toThrow();
});

test("DHT lookup requests peers without announcing and filters private contacts", async () => {
  const request = jest.fn(async (_host, _port, packet) => {
    const query = decode(packet).value;
    expect(query.q.toString()).toBe("get_peers");
    const values = [Buffer.from([8, 8, 8, 8, 26, 225]), Buffer.from([127, 0, 0, 1, 26, 225])];
    return encode({ t: query.t, y: "r", r: { id: Buffer.alloc(20), values } });
  });
  expect(await discoverPeers(hash, signal(), { udpRequest: request })).toEqual([{ host: "8.8.8.8", port: 6881 }]);
  expect(request).toHaveBeenCalledTimes(3);
});

async function fakePeer(metadata, options = {}) {
  const commands = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0); let hello = false;
    const frame = (extension, value, tail = Buffer.alloc(0)) => {
      const body = Buffer.concat([Buffer.from([20, extension]), encode(value), tail]);
      const length = Buffer.alloc(4); length.writeUInt32BE(body.length); socket.write(Buffer.concat([length, body]));
    };
    socket.on("error", () => {});
    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      if (!hello && buffer.length >= 68) {
        const handshake = Buffer.from(buffer.subarray(0, 68)); buffer = buffer.subarray(68); hello = true;
        socket.write(handshake); frame(0, { m: { ut_metadata: 2 }, metadata_size: options.size || metadata.length });
      }
      while (hello && buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
        const length = buffer.readUInt32BE(0); const message = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
        commands.push(message[0]);
        if (message[0] === 20 && message[1] === 2) {
          const header = decode(message.subarray(2)).value;
          const {piece} = header;
          frame(1, { msg_type: 1, piece, total_size: metadata.length }, metadata.subarray(piece * 16384, (piece + 1) * 16384));
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { peer: { host: "127.0.0.1", port: server.address().port }, commands, close: () => new Promise(resolve => server.close(resolve)) };
}

test("real peer exchange retrieves verified contents and never requests payload pieces", async () => {
  const fixture = await fakePeer(info);
  try {
    const result = await peerMetadata(fixture.peer, { infoHashV1: hash }, { signal: signal(), allowPeer: () => true });
    expect(result.files).toEqual([{ path: "Public synthetic book.txt", size: 4 }]);
    expect(fixture.commands.length).toBeGreaterThan(0);
    expect(fixture.commands.every(id => id === 20)).toBe(true);
  }
  finally {
    await fixture.close();
  }
});

test.each(["wrong hash", "oversized"])("rejects %s metadata without downloading content", async kind => {
  const fixture = await fakePeer(info, { size: kind === "oversized" ? 3 * 1024 * 1024 : undefined });
  try {
    await expect(peerMetadata(fixture.peer, { infoHashV1: kind === "wrong hash" ? "a".repeat(40) : hash }, { signal: signal(), allowPeer: () => true })).rejects.toThrow();
    expect(fixture.commands.every(id => id === 20)).toBe(true);
  }
  finally {
    await fixture.close();
  }
});

test("already cancelled peer lookups never create a socket", async () => {
  const controller = new AbortController(); controller.abort(); const connect = jest.fn();
  await expect(peerMetadata({ host: "8.8.8.8", port: 6881 }, { infoHashV1: hash }, { signal: controller.signal, connect })).rejects.toThrow("cancelled");
  expect(connect).not.toHaveBeenCalled();
});

test("v2 peer metadata verifies the full SHA-256 identity", async () => {
  const v2 = encode({ "name": "V2 book", "meta version": 2, "piece length": 16384,
    "file tree": { "book.txt": { "": { "length": 4, "pieces root": Buffer.alloc(32, 1) } } } });
  const fixture = await fakePeer(v2);
  try {
    const result = await peerMetadata(fixture.peer, { infoHashV2: createHash("sha256").update(v2).digest("hex") }, { signal: signal(), allowPeer: () => true });
    expect(result.files[0]).toMatchObject({ path: "book.txt", size: 4 });
    expect(result.infoHashV2).toHaveLength(64); expect(fixture.commands.every(id => id === 20)).toBe(true);
  }
  finally {
    await fixture.close();
  }
});
