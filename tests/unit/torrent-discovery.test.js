"use strict";

const { createHash } = require("node:crypto");
const { discoverTorrent, lookup, peerCandidates } = require("../../lib/torrent-discovery");
const { presentTorrent } = require("../../common/torrent-presentation");

const magnet = name => ({ kind: "magnet", name, infoHashV1: createHash("sha1").update(name).digest("hex"), magnet: "magnet:?xt=synthetic", trackers: ["https://a.example/announce", "udp://b.example:6969"], files: [] });

test("metadata resolution uses actual contents and overlapping tracker maxima", async () => {
  const input = magnet("resolved");
  const network = {
    discoverPeers: jest.fn(async () => [{ host: "8.8.8.8", port: 6881 }]),
    peerMetadata: jest.fn(async () => ({ name: "Book", files: [{ path: "Book.pdf", size: 80 }], totalSize: 80, fileCount: 1 })),
    scrapeTracker: jest.fn(async raw => ({ seeders: raw.startsWith("udp") ? 5 : 4, leechers: 2, completed: 9 })),
  };
  const result = await discoverTorrent(input, { enabled: true, withLease: false, network });
  expect(result).toMatchObject({ totalSize: 80, discovery: { state: "complete", source: "peer" }, availability: { seeders: 5, leechers: 2, responding: 2 } });
  expect(result.trackerStatus.every(row => !Object.hasOwn(row, "url"))).toBe(true);
  await discoverTorrent(input, { enabled: true, withLease: false, network, force: true });
  expect(network.discoverPeers).toHaveBeenCalledTimes(1);
});

test("private torrents never query DHT and unknown counts remain null", async () => {
  const network = { discoverPeers: jest.fn(), scrapeTracker: async () => {
    throw new Error("offline");
  } };
  const result = await lookup({ ...magnet("private"), private: true, files: [{ path: "a.pdf", size: 1 }] }, { network });
  expect(network.discoverPeers).not.toHaveBeenCalled();
  expect(result.availability.seeders).toBeNull();
  expect(result.discovery.state).toBe("complete");
});

test("disabled and busy servers return useful states without network traffic", async () => {
  const network = { discoverPeers: jest.fn(), scrapeTracker: jest.fn() };
  expect((await discoverTorrent(magnet("disabled"), { enabled: false, network })).discovery.state).toBe("disabled");
  expect((await discoverTorrent(magnet("busy"), { enabled: true, network, withLease: async () => {
    throw Object.assign(new Error("busy"), { status: 409 });
  } })).discovery.state).toBe("busy");
  expect(network.discoverPeers).not.toHaveBeenCalled();
  expect(network.scrapeTracker).not.toHaveBeenCalled();
});

test("the presentation prioritizes real file types and does not invent missing facts", () => {
  const input = magnet("unresolved"); input.name = input.infoHashV1;
  expect(presentTorrent(input)).toMatchObject({ name: "Torrent", known: false, size: null, category: "Torrent" });
  expect(presentTorrent({ name: "Library", totalSize: 100, files: [{ path: "Book.epub", size: 100 }] })).toMatchObject({ category: "Books & documents", known: true, size: 100 });
});

test("cached and simultaneous lookups keep each source's name, description and magnet", async () => {
  const input = { ...magnet("cache-isolation"), comment: "First source", imageDataUrl: "first", parameters: { dn: ["first"] } };
  const network = { discoverPeers: async () => [], scrapeTracker: async () => ({ seeders: 0, leechers: 0 }) };
  const second = { ...input, name: "Second source", comment: "Second description", imageDataUrl: "second", magnet: "magnet:?second", parameters: { dn: ["second"] } };
  const [, simultaneous] = await Promise.all([discoverTorrent(input, { enabled: true, withLease: false, network }), discoverTorrent(second, { enabled: true, withLease: false, network })]);
  const cached = await discoverTorrent(second, { enabled: true, withLease: false, network });
  for (const result of [simultaneous, cached]) {
    expect(result).toMatchObject({ name: second.name, comment: second.comment, imageDataUrl: second.imageDataUrl, magnet: second.magnet, parameters: second.parameters });
    expect(result.availability.completed).toBeNull();
    expect(result.availability.seeders).toBe(0);
  }
});

test("coordination failures preserve valid metadata and do not start network traffic", async () => {
  const input = magnet("coordination-down"); const network = { discoverPeers: jest.fn() };
  const result = await discoverTorrent(input, { enabled: true, network, withLease: async () => {
    throw new Error("Redis unavailable");
  } });
  expect(result).toMatchObject({ name: input.name, magnet: input.magnet, discovery: { state: "unavailable" } });
  expect(network.discoverPeers).not.toHaveBeenCalled();
});

test("refreshing stored peer contents preserves their provenance", async () => {
  const input = { ...magnet("stored-peer"), files: [{ path: "book.txt", size: 4 }], discovery: { source: "peer" } };
  const network = { discoverPeers: jest.fn(), scrapeTracker: async () => ({ seeders: 1, leechers: 0 }) };
  expect((await lookup(input, { network })).discovery.source).toBe("peer");
  expect(network.discoverPeers).not.toHaveBeenCalled();
});

test("tracker contacts resolve metadata when DHT has no peers and leave the tracker afterwards", async () => {
  const input = magnet("tracker-contents"); const contact = { host: "8.8.8.8", port: 6881 };
  const network = {
    discoverPeers: jest.fn(async () => []),
    scrapeTracker: jest.fn(async () => ({ seeders: 120, leechers: 2 })),
    announceTracker: jest.fn(async () => ({ peers: [contact] })),
    peerMetadata: jest.fn(async () => ({ files: [{ path: "film.mkv", size: 100 }], fileCount: 1, totalSize: 100 })),
  };
  const result = await lookup(input, { network });
  expect(result).toMatchObject({ discovery: { state: "complete", peersFound: 1, peersTried: 1 }, files: [{ path: "film.mkv" }] });
  const starts = network.announceTracker.mock.calls.filter(call => !call[3].event);
  const stops = network.announceTracker.mock.calls.filter(call => call[3].event === "stopped");
  expect(starts).toHaveLength(2); expect(stops).toHaveLength(2);
  expect(starts[0][2]).toHaveLength(20); expect(stops[0][2]).toEqual(starts[0][2]);
  expect(network.peerMetadata.mock.calls[0][2].peerId).toEqual(starts[0][2]);
  expect(network.peerMetadata.mock.calls[0][2].signal.aborted).toBe(true);
});

test("peer candidates interleave sources, deduplicate and reject private destinations", () => {
  const a = Array.from({ length: 24 }, (_, i) => ({ host: `8.8.8.${i + 1}`, port: 6881 }));
  const b = Array.from({ length: 24 }, (_, i) => ({ host: `9.9.9.${i + 1}`, port: 6881 }));
  const result = peerCandidates([a, b, [a[0], { host: "127.0.0.1", port: 6881 }]]);
  expect(result).toHaveLength(48); expect(result.slice(0, 4)).toEqual([a[0], b[0], a[1], b[1]]);
});

test("a free metadata slot tries later contacts without waiting for a stalled batch", async () => {
  const input = magnet("refill-metadata"); const contacts = Array.from({ length: 8 }, (_, i) => ({ host: `8.8.8.${i + 1}`, port: 6881 }));
  const network = {
    discoverPeers: async () => contacts, announceTracker: async () => ({ peers: [] }), scrapeTracker: async () => ({ seeders: 1 }),
    peerMetadata: jest.fn(async (peer, _torrent, { signal }) => {
      if (peer.host.endsWith(".1")) {
        await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); throw new Error("Cancelled");
      }
      if (peer.host.endsWith(".8")) {
        return { files: [{ path: "verified.txt", size: 1 }] };
      }
      throw new Error("Unreachable");
    }),
  };
  expect((await lookup(input, { network })).files).toEqual([{ path: "verified.txt", size: 1 }]);
  expect(network.peerMetadata).toHaveBeenCalledTimes(8);
});

test("private torrents and known contents never announce for metadata", async () => {
  const network = { discoverPeers: jest.fn(), announceTracker: jest.fn(), peerMetadata: jest.fn(), scrapeTracker: async () => ({ seeders: 1 }) };
  await lookup({ ...magnet("private-empty"), private: true }, { network });
  await lookup({ ...magnet("known-contents"), files: [{ path: "a.txt", size: 1 }] }, { network });
  expect(network.announceTracker).not.toHaveBeenCalled(); expect(network.peerMetadata).not.toHaveBeenCalled();
});

test("unresolved lookup distinguishes no contacts from peers declining metadata without exposing addresses", async () => {
  const network = { discoverPeers: async () => [], announceTracker: async () => ({ peers: [] }), scrapeTracker: async () => ({ seeders: 100 }) };
  expect((await lookup(magnet("no-contacts"), { network })).discovery.reason).toBe("no-peers");
  network.announceTracker = async () => ({ peers: [{ host: "8.8.8.8", port: 6881 }] });
  network.peerMetadata = async () => {
    throw new Error("Declined");
  };
  const result = await lookup(magnet("declined"), { network });
  expect(result.discovery).toMatchObject({ state: "unavailable", reason: "metadata-unavailable", peersFound: 1, peersTried: 1 });
  expect(JSON.stringify(result.discovery)).not.toContain("8.8.8.8");
});
