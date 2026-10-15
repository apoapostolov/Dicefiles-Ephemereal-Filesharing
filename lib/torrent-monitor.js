"use strict";

const { createHash } = require("node:crypto");
const { scrapeTracker } = require("./torrent-network");
const { withLease } = require("./redis-lease");

const INTERVAL = 15 * 60000;
const RETRY = 30 * 60000;
const BATCH_SIZE = 4;

function identity(torrent) {
  const hash = torrent?.infoHashV1 || torrent?.infoHashV2?.slice(0, 40);
  if (!/^[a-f\d]{40}$/i.test(hash || "")) {
    return null;
  }
  return createHash("sha256").update(JSON.stringify([hash, torrent.private === true, [...new Set(Array.isArray(torrent.trackers) ? torrent.trackers : [])].sort()])).digest("hex");
}

function supportedTrackers(torrent) {
  return [...new Set(Array.isArray(torrent.trackers) ? torrent.trackers : [])].filter(raw => {
    try {
      const url = new URL(raw);
      return raw.length <= 2048 && !url.username && !url.password && (url.protocol === "udp:" || ["http:", "https:"].includes(url.protocol) && /\/announce[^/]*$/.test(url.pathname));
    }
    catch (_) {
      return false;
    }
  }).slice(0, 6);
}

function dueGroups(references, now = Date.now()) {
  const groups = new Map();
  for (const ref of references) {
    const torrent = ref.item.meta?.torrent;
    const id = identity(torrent);
    if (!id || ref.item.expires <= now || !supportedTrackers(torrent).length) {
      continue;
    }
    const stats = torrent.availability || {};
    const due = stats.nextCheckAt || (stats.checkedAt ? stats.checkedAt + INTERVAL : 0);
    const group = groups.get(id) || { id, torrent, refs: [], due: 0 };
    // The newest copy determines the schedule for an identical swarm.
    group.due = Math.max(group.due, due); group.refs.push(ref); groups.set(id, group);
  }
  return [...groups.values()].filter(group => group.due <= now).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id)).slice(0, BATCH_SIZE);
}

async function checkTorrent(torrent, { now = Date.now(), scrape = scrapeTracker, signal = AbortSignal.timeout(8000) } = {}) {
  const trackers = supportedTrackers(torrent);
  const hash = torrent.infoHashV1 || torrent.infoHashV2.slice(0, 40);
  const trackerStatus = await Promise.all(trackers.map(async raw => {
    const url = new URL(raw);
    const endpoint = { host: url.hostname, protocol: url.protocol.slice(0, -1), checkedAt: now };
    try {
      const stats = await scrape(raw, hash, signal);
      return { ...endpoint, ...Object.fromEntries(["seeders", "leechers", "completed"].map(key => [key, Number.isSafeInteger(stats[key]) && stats[key] >= 0 ? stats[key] : null])), state: "responding" };
    }
    catch (_) {
      return { ...endpoint, state: "unavailable" };
    }
  }));
  const responding = trackerStatus.filter(row => row.state === "responding" && (row.seeders !== null || row.leechers !== null));
  const previous = torrent.availability || {};
  const maximum = key => {
    const counts = responding.map(row => row[key]).filter(value => Number.isSafeInteger(value));
    return counts.length ? Math.max(...counts) : null;
  };
  const reportedAt = responding.length ? now : previous.reportedAt || (previous.responding ? previous.checkedAt : null);
  // Deterministic jitter survives restarts and spreads different swarms out.
  const jitter = (parseInt(identity(torrent).slice(0, 6), 16) % 360001) - 180000;
  return { trackerStatus, availability: {
    seeders: responding.length ? maximum("seeders") : previous.seeders ?? null,
    leechers: responding.length ? maximum("leechers") : previous.leechers ?? null,
    completed: responding.length ? maximum("completed") : previous.completed ?? null,
    responding: responding.length, total: trackers.length, checkedAt: now, reportedAt,
    state: responding.length ? "current" : reportedAt ? "stale" : "unknown",
    nextCheckAt: now + (responding.length ? INTERVAL : RETRY) + jitter,
  } };
}

async function runBatch({ sources, lease = withLease, check = checkTorrent, now = Date.now() } = {}) {
  return lease("lock:torrent-monitor", async assertOwned => {
    const refs = [];
    for (const { map, Type } of sources) {
      for (const [key, item] of await map.entriesFresh()) {
        refs.push({ map, Type, key, item });
      }
    }
    const groups = dueGroups(refs, now);
    for (const group of groups) {
      await assertOwned();
      const facts = await check(group.torrent, { now });
      await assertOwned();
      for (const { map, Type, key } of group.refs) {
        try {
          await map.updateAtomic(key, current => {
            if (current.expired || current.expires <= Date.now() || identity(current.meta?.torrent) !== group.id) {
              throw Object.assign(new Error("Torrent changed during check"), { status: 409 });
            }
            // A manual refresh that finished later wins over this report.
            if ((current.meta.torrent.availability?.checkedAt || 0) > now) {
              return current;
            }
            return new Type({ ...current.toJSON(), meta: { ...current.meta, torrent: { ...current.meta.torrent, ...facts } } });
          });
        }
        catch (error) {
          if (![404, 409].includes(error.status)) {
            throw error;
          }
        }
      }
    }
    return groups.length;
  }, { ttlMs: 60000, waitMs: 0 });
}

function start() {
  let running = false;
  const tick = async () => {
    const config = require("./config");

    if (running || config.get("torrentDiscovery") === false || config.get("torrentMonitor") === false) {
      return;
    }
    running = true;
    try {
      const { UPLOADS, Upload } = require("./upload");
      const { LINKS, Link } = require("./links");

      await runBatch({ sources: [{ map: UPLOADS, Type: Upload }, { map: LINKS, Type: Link }] });
    }
    catch (error) {
      if (error.status !== 409) {
        console.error("Torrent availability check failed; the next scheduled check will retry.", error.name || "Error");
      }
    }
    finally {
      running = false;
    }
  };
  // Dedicated maintenance worker only; no per-room/client polling timers.
  const first = setTimeout(tick, 45000); first.unref();
  const timer = setInterval(tick, 60000); timer.unref();
  return () => {
    clearTimeout(first); clearInterval(timer);
  };
}

module.exports = { identity, supportedTrackers, dueGroups, checkTorrent, runBatch, start };
