"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { LRUCache } = require("lru-cache");
const network = require("./torrent-network");
const { withLease } = require("./redis-lease");

const cache = new LRUCache({ max: 32, maxSize: 8 * 1024 * 1024, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value)), ttl: 10 * 60000 });
const pending = new Map();

function contentsSource(torrent) {
  return !torrent.files?.length ? "magnet" : torrent.discovery?.source || (torrent.kind === "magnet" ? "http-source" : "torrent-file");
}

function peerCandidates(sources) {
  const unique = new Map();
  // Round-robin sources so stale contacts from one tracker cannot fill the cap.
  for (let i = 0; i < 24 && unique.size < 48; i++) {
    for (const peers of sources) {
      const peer = peers[i];
      if (network.validPeer(peer) && unique.size < 48) {
        unique.set(`${peer.host}:${peer.port}`, peer);
      }
    }
  }
  return [...unique.values()];
}

async function peerContents(torrent, api, trackers, signal) {
  const controller = new AbortController();
  const lookupSignal = AbortSignal.any([signal, controller.signal]);
  const peerId = Buffer.concat([Buffer.from("-DF0001-"), randomBytes(12)]);
  const hash = torrent.infoHashV1 || torrent.infoHashV2.slice(0, 40);
  const announced = [];
  let peers = []; let next = 0;
  try {
    const sources = await Promise.allSettled([
      api.discoverPeers(hash, AbortSignal.any([lookupSignal, AbortSignal.timeout(6500)])),
      ...trackers.filter(raw => /^(udp|https?):\/\//i.test(raw)).map(async raw => {
        const report = await api.announceTracker(raw, hash, peerId, { signal: AbortSignal.any([lookupSignal, AbortSignal.timeout(5000)]) });
        announced.push(raw); return report.peers;
      }),
    ]);
    peers = peerCandidates(sources.filter(row => row.status === "fulfilled" && Array.isArray(row.value)).map(row => row.value));
    const attempt = async () => {
      while (next < peers.length && !lookupSignal.aborted) {
        const peer = peers[next++];
        try {
          return await api.peerMetadata(peer, torrent, { signal: lookupSignal, peerId });
        }
        catch (_) { /* Refill this slot immediately; one slow peer cannot hold a batch. */ }
      }
      throw new Error("No verified peer metadata");
    };
    const result = await Promise.any(Array.from({ length: Math.min(4, peers.length) }, attempt));
    return { result, peersFound: peers.length, peersTried: next };
  }
  catch (_) {
    return { peersFound: peers.length, peersTried: next, reason: peers.length ? "metadata-unavailable" : "no-peers" };
  }
  finally {
    controller.abort();
    // Announce only to obtain metadata contacts; leave the tracker afterwards.
    await Promise.allSettled(announced.map(raw => api.announceTracker(raw, hash, peerId, { event: "stopped", signal: AbortSignal.timeout(1500) })));
  }
}

async function lookup(torrent, options) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
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
  let diagnostics = {};
  if (!torrent.files?.length && torrent.private !== true && !signal.aborted) {
    const { result, ...details } = await peerContents(torrent, api, trackers, signal);
    diagnostics = details;
    if (result) {
      // BEP 9 transfers only the info dictionary. Trackers, commentary and
      // source fields must retain their provenance from the original link.
      resolved = { ...torrent, ...result, kind: torrent.kind, magnet: torrent.magnet,
        trackers: torrent.trackers, trackerTiers: torrent.trackerTiers || [],
        comment: torrent.comment || "", publisher: torrent.publisher || "", publisherUrl: torrent.publisherUrl || "",
        imageDataUrl: torrent.imageDataUrl, metadataStatus: "verified-peer" };
      source = "peer";
    }
  }
  await statsPromise;
  const responding = trackerStatus.filter(row => row.state === "responding");
  const max = key => {
    const values = responding.map(row => row[key]).filter(Number.isSafeInteger);
    return values.length ? Math.max(...values) : torrent.availability?.[key] ?? null;
  };
  return { ...resolved,
    discovery: { state: resolved.files?.length ? "complete" : "unavailable", source, checkedAt, ...diagnostics },
    trackerStatus,
    availability: { seeders: max("seeders"), leechers: max("leechers"), completed: max("completed"), responding: responding.length, total: trackers.length, checkedAt,
      reportedAt: responding.length ? checkedAt : torrent.availability?.reportedAt || (torrent.availability?.responding ? torrent.availability.checkedAt : null),
      state: responding.length ? "current" : torrent.availability?.reportedAt || torrent.availability?.responding ? "stale" : "unknown" },
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
        return await lease(`lock:torrent-discovery:${slot}`, run, { ttlMs: 40000, waitMs: 0 });
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

module.exports = { discoverTorrent, lookup, peerCandidates };
