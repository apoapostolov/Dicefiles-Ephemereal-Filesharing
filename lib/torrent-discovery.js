"use strict";

const { createHash } = require("node:crypto");
const { LRUCache } = require("lru-cache");
const network = require("./torrent-network");
const { withLease } = require("./redis-lease");

const cache = new LRUCache({ max: 32, maxSize: 8 * 1024 * 1024, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value)), ttl: 10 * 60000 });
const pending = new Map();

function contentsSource(torrent) {
  return !torrent.files?.length ? "magnet" : torrent.discovery?.source || (torrent.kind === "magnet" ? "http-source" : "torrent-file");
}

async function lookup(torrent, options) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  const api = options.network || network;
  const hash = torrent.infoHashV1 || torrent.infoHashV2?.slice(0, 40);
  const checkedAt = Date.now();
  const trackerStatus = [];
  const trackers = [...new Set(torrent.trackers || [])].slice(0, 8);
  const statsPromise = Promise.allSettled(trackers.map(async tracker => {
    let endpoint;
    try {
      const url = new URL(tracker);
      endpoint = { host: url.hostname, protocol: url.protocol.replace(":", "") };
      const stats = await api.scrapeTracker(tracker, hash, signal);
      trackerStatus.push({ ...endpoint, ...stats, state: "responding", checkedAt });
    }
    catch (_) {
      trackerStatus.push({ ...(endpoint || { host: "Unsupported tracker", protocol: "" }), state: "unavailable", checkedAt });
    }
  }));
  let resolved = torrent;
  let source = contentsSource(torrent);
  if (!torrent.files?.length && torrent.private !== true && !signal.aborted) {
    try {
      const dhtSignal = AbortSignal.any([signal, AbortSignal.timeout(6500)]);
      const peers = await api.discoverPeers(hash, dhtSignal);
      // Up to three simultaneous connections, eight attempts, no payload requests.
      const candidates = peers.slice(0, 8);
      for (let offset = 0; offset < candidates.length && !signal.aborted; offset += 3) {
        const group = new AbortController();
        try {
          const result = await Promise.any(candidates.slice(offset, offset + 3).map(peer => api.peerMetadata(peer, torrent, { signal: AbortSignal.any([signal, group.signal]) })));
          // BEP 9 transfers only the info dictionary. Trackers, commentary and
          // source fields must retain their provenance from the original link.
          resolved = { ...torrent, ...result, kind: torrent.kind, magnet: torrent.magnet,
            trackers: torrent.trackers, trackerTiers: torrent.trackerTiers || [],
            comment: torrent.comment || "", publisher: torrent.publisher || "", publisherUrl: torrent.publisherUrl || "",
            imageDataUrl: torrent.imageDataUrl, metadataStatus: "verified-peer" };
          source = "peer"; break;
        }
        catch (_) { /* Try another bounded group of public peers. */ }
        finally {
          group.abort();
        }
      }
    }
    catch (_) { /* Unknown availability is an honest, usable result. */ }
  }
  await statsPromise;
  const responding = trackerStatus.filter(row => row.state === "responding");
  const max = key => {
    const values = responding.map(row => row[key]).filter(Number.isSafeInteger);
    return values.length ? Math.max(...values) : null;
  };
  return { ...resolved,
    discovery: { state: resolved.files?.length ? "complete" : "unavailable", source, checkedAt },
    trackerStatus,
    availability: { seeders: max("seeders"), leechers: max("leechers"), completed: max("completed"), responding: responding.length, total: trackers.length, checkedAt },
  };
}

async function discoverTorrent(torrent, options = {}) {
  const enabled = options.enabled ?? require("./config").get("torrentDiscovery") !== false;
  if (!enabled || !torrent.infoHashV1 && !torrent.infoHashV2) {
    return { ...torrent, discovery: { state: "disabled", source: contentsSource(torrent), checkedAt: null } };
  }
  const identity = createHash("sha256").update(JSON.stringify([torrent.infoHashV1, torrent.infoHashV2, torrent.private, torrent.trackers || []])).digest("hex");
  const hit = cache.get(identity);
  const merge = facts => {
    // Cache only verified discovery facts. Source descriptions, artwork, magnet
    // parameters and private tracker credentials belong to the current item.
    const result = { ...torrent, ...facts };
    if (torrent.name && torrent.name !== torrent.infoHashV1 && torrent.name !== torrent.infoHashV2) {
      result.name = torrent.name;
    }
    return result;
  };
  if (hit && (!options.force || Date.now() - hit.discovery.checkedAt < 60000)) {
    return merge(hit);
  }
  if (pending.has(identity)) {
    return merge(await pending.get(identity));
  }
  const run = async () => {
    const result = await lookup(torrent, options);
    const keys = ["name", "files", "fileCount", "totalSize", "version", "private", "pieceLength", "pieceCount", "metadataStatus", "discovery", "trackerStatus", "availability"];
    const facts = Object.fromEntries(keys.filter(key => result[key] !== undefined).map(key => [key, result[key]]));
    cache.set(identity, facts, { ttl: result.discovery.state === "complete" ? 10 * 60000 : 2 * 60000 });
    return facts;
  };
  const promise = (async () => {
    if (options.withLease === false) {
      return run();
    }
    // Global worker coordination bounds outbound discovery to two lookups.
    const lease = options.withLease || withLease;
    for (let slot = 0; slot < 2; slot++) {
      try {
        return await lease(`lock:torrent-discovery:${slot}`, run, { ttlMs: 20000, waitMs: 0 });
      }
      catch (error) {
        if (error.status !== 409) {
          return { discovery: { state: "unavailable", source: contentsSource(torrent), checkedAt: null } };
        }
      }
    }
    return { discovery: { state: "busy", source: contentsSource(torrent), checkedAt: null } };
  })().finally(() => pending.delete(identity));
  pending.set(identity, promise);
  return merge(await promise);
}

module.exports = { discoverTorrent, lookup };
