"use strict";

const { announceTracker, compactPeers } = require("../../lib/torrent-network");
const { encode } = require("../../lib/torrent-bencode");

const peerId = Buffer.alloc(20, 65); const hash = "a".repeat(40);
const peers = Buffer.from([127, 0, 0, 1, 0x1a, 0xe1, 8, 8, 8, 8, 0x1a, 0xe1]);

test("explicit playback gets compact public tracker peers with a bounded guarded HTTP request", async () => {
  const fetcher = jest.fn(async () => new Response(encode({ interval: 1800, peers })));
  const result = await announceTracker("https://tracker.example/announce?passkey=synthetic", hash, peerId, { fetcher, left: 100 });
  expect(result).toEqual({ interval: 1800, peers: [{ host: "8.8.8.8", port: 6881 }] });
  const [url, , policy] = fetcher.mock.calls[0];
  expect(url).toContain("info_hash=%aa%aa"); expect(url).toContain("peer_id=%41%41");
  expect(url).toContain("numwant=24"); expect(url).toContain("event=started");
  expect(policy).toMatchObject({ maxBytes: 65536, maxRedirects: 0, timeoutMs: 4000 });
  expect((await announceTracker("https://tracker.example/announce", hash, peerId, { fetcher, event: "stopped" })).peers).toEqual([]);
});

test("UDP playback announces verify transactions, retain exact hashes and never return private peers", async () => {
  const udp = jest.fn(async (_host, _port, packet) => {
    if (packet.readUInt32BE(8) === 0) {
      const response = Buffer.alloc(16); packet.copy(response, 4, 12, 16); response.writeBigUInt64BE(42n, 8); return response;
    }
    expect(packet.length).toBe(98); expect(packet.subarray(16, 36).toString("hex")).toBe(hash);
    expect(packet.subarray(36, 56)).toEqual(peerId); expect(packet.readUInt32BE(80)).toBe(2);
    expect(packet.readUInt32BE(92)).toBe(24); expect(packet.readBigUInt64BE(64)).toBe(100n);
    const response = Buffer.alloc(20 + peers.length); response.writeUInt32BE(1); packet.copy(response, 4, 12, 16); response.writeUInt32BE(1800, 8); peers.copy(response, 20); return response;
  });
  const result = await announceTracker("udp://tracker.example:6969", hash, peerId, { udp, resolve: async () => ({ address: "8.8.4.4", family: 4 }), left: 100 });
  expect(result.peers).toEqual([{ host: "8.8.8.8", port: 6881 }]); expect(udp).toHaveBeenCalledTimes(2);
});

test("tracker failures and malformed playback requests are rejected without exposing provider text", async () => {
  const fetcher = jest.fn(async () => new Response(encode({ "failure reason": "private tracker response" })));
  await expect(announceTracker("https://tracker.example/announce", hash, peerId, { fetcher })).rejects.toThrow("unavailable");
  await expect(announceTracker("file:///etc/passwd", hash, peerId)).rejects.toThrow("Unsupported");
  await expect(announceTracker("https://user:pass@example.org/announce", hash, peerId)).rejects.toThrow("Invalid");
  await expect(announceTracker("https://tracker.example/announce", "bad", peerId)).rejects.toThrow("Invalid");
  expect(compactPeers(Buffer.alloc(18), 6)).toEqual([]);
});
