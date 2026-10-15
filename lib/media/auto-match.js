"use strict";

const { filenameQuery } = require("../../common/video");
const { withLease } = require("../redis-lease");

const normalizeTitle = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const VIDEO = /\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts)$/i;

function matchInput(path, torrentName) {
  const parsed = filenameQuery(path);
  const parent = filenameQuery(`${torrentName || ""}.mkv`);
  if (parsed.query.length < 2 || /^(?:movie|video|episode|s\d{1,2}|e\d{1,3}|\d+)$/i.test(parsed.query)) {
    parsed.query = parent.query.replace(/\b(?:season\s*\d+|s\d{1,2}|complete)\b.*$/i, "").trim();
  }
  if (!parsed.year && normalizeTitle(parsed.query) === normalizeTitle(parent.query)) {
    parsed.year = parent.year;
  }
  return parsed;
}

function confidentSelection(input, candidates) {
  const exact = candidates.filter(candidate => normalizeTitle(candidate.title) === normalizeTitle(input.query) && (input.episode !== null ? candidate.kind === "episode" : candidate.kind === "movie") && (!input.year || String(candidate.year) === String(input.year)));
  const editions = new Map();
  for (const candidate of exact) {
    const key = `${candidate.kind}:${candidate.year || "unknown"}`;
    const rows = editions.get(key) || []; rows.push(candidate); editions.set(key, rows);
  }
  if (editions.size !== 1) {
    return null;
  }
  const choices = [...editions.values()][0];
  // Exact title + year, or an exact unique series and episode number. A bare
  // movie title additionally needs agreement from two configured catalogues.
  if (!input.year && input.episode === null && new Set(choices.map(row => row.provider)).size < 2) {
    return null;
  }
  // Two distinct same-provider titles are not a unique edition, even in one year.
  for (const provider of new Set(choices.map(row => row.provider))) {
    if (new Set(choices.filter(row => row.provider === provider).map(row => row.id)).size > 1) {
      return null;
    }
  }
  return choices.find(row => row.provider === "tmdb") || choices[0];
}

function pendingVideos(sources, now = Date.now(), limit = 2) {
  const jobs = [];
  for (const { map, kind } of sources) {
    for (const [key, item] of map) {
      const files = item?.meta?.torrent?.files;
      if (item?.expires <= now || !Array.isArray(files)) {
        continue;
      }
      for (let index = 0; index < Math.min(files.length, 2000); index++) {
        if (!VIDEO.test(files[index].path || "")) {
          continue;
        }
        const record = item.meta.cinema?.[index]; const state = record?.autoMatch;
        if (record?.movie || state && (state.state !== "retry" || state.nextAttemptAt > now)) {
          continue;
        }
        jobs.push({ map, reference: { kind, key, index }, item, path: files[index].path, due: state?.nextAttemptAt || item.uploaded || item.date || 0 });
      }
    }
  }
  return jobs.sort((a, b) => a.due - b.due).slice(0, limit);
}

async function matchVideo(path, torrentName, catalog) {
  if (/\b(?:sample|trailer|featurette|extras?)\b/i.test(path.replace(/[._-]/g, " ")) || /S\d{1,2}E\d{1,3}(?:E\d|[- ]E\d)/i.test(path)) {
    return { reason: "special-content" };
  }
  const input = matchInput(path, torrentName);
  if (input.query.length < 2 || /^(movie|video|episode)$/i.test(input.query)) {
    return { reason: "needs-title" };
  }
  const found = await catalog.search(path, input.query);
  if (!found.candidates.length && found.warnings?.length) {
    throw new Error("Metadata provider unavailable");
  }
  const selection = confidentSelection(input, found.candidates);
  if (!selection) {
    return { reason: found.candidates.length ? "ambiguous" : "no-match" };
  }
  const movie = await catalog.resolve(selection);
  const sameTitle = normalizeTitle(movie.kind === "episode" ? movie.series : movie.title) === normalizeTitle(input.query);
  const sameEdition = input.episode !== null ? movie.kind === "episode" && movie.season === input.season && movie.episode === input.episode : movie.kind === "movie" && (!input.year || String(movie.year) === String(input.year));
  return sameTitle && sameEdition ? { movie, basis: input.episode !== null ? "series-episode" : input.year ? "title-year" : "catalogue-agreement" } : { reason: "ambiguous" };
}

async function runBatch({ sources, catalog, apply, lease = withLease, now = Date.now() }) {
  return lease("lock:movie-auto-match", async assertOwned => {
    for (const { map } of sources) {
      await map.loaded;
    }
    const jobs = pendingVideos(sources, now);
    for (const job of jobs) {
      const fresh = await job.map.getFresh(job.reference.key);
      const existing = fresh?.meta?.cinema?.[job.reference.index];
      if (!fresh || fresh.expires <= now || existing?.movie || existing?.autoMatch && (existing.autoMatch.state !== "retry" || existing.autoMatch.nextAttemptAt > now) || fresh.meta?.torrent?.files?.[job.reference.index]?.path !== job.path) {
        continue;
      }
      const attempts = (existing?.autoMatch?.attempts || 0) + 1;
      let result;
      try {
        const matched = await matchVideo(job.path, fresh.meta.torrent.name || fresh.name, catalog);
        result = { movie: matched.movie, autoMatch: { state: matched.movie ? "matched" : "review", confidence: matched.movie ? "high" : null, basis: matched.basis || null, reason: matched.reason || null, checkedAt: now, attempts } };
      }
      catch (_) {
        result = { autoMatch: { state: attempts < 3 ? "retry" : "review", reason: "provider-unavailable", checkedAt: now, attempts, nextAttemptAt: now + (attempts === 1 ? 5 : 30) * 60000 } };
      }
      await assertOwned();
      try {
        await apply(job.reference, { path: job.path, hash: fresh.meta.torrent.infoHashV1 || fresh.meta.torrent.infoHashV2 }, result);
      }
      catch (error) {
        if (![404, 409].includes(error.status)) {
          throw error;
        }
      }
    }
    return jobs.length;
  }, { ttlMs: 90000, waitMs: 0 });
}

async function refreshContents({ sources, enrich, now = Date.now(), lease = withLease }) {
  return lease("lock:movie-auto-contents", async assertOwned => {
    for (const { map, Type } of sources) {
      await map.loaded;
      for (const [key, item] of map) {
        const torrent = item?.meta?.torrent;
        const hash = torrent?.infoHashV1 || torrent?.infoHashV2;
        if (!hash || item.expires <= now || Array.isArray(torrent.files) && torrent.files.length || torrent.autoMatchContents?.nextAttemptAt > now) {
          continue;
        }
        let resolved;
        try {
          resolved = await enrich({ ...torrent, trackers: Array.isArray(torrent.trackers) ? torrent.trackers : [] }, { discovery: true });
        }
        catch (_) {
          resolved = torrent;
        }
        await assertOwned();
        await map.updateAtomic(key, current => {
          if (current.expires <= Date.now() || (current.meta?.torrent?.infoHashV1 || current.meta?.torrent?.infoHashV2) !== hash) {
            throw Object.assign(new Error("Torrent changed during discovery"), { status: 409 });
          }
          if (Array.isArray(current.meta.torrent.files) && current.meta.torrent.files.length) {
            return current;
          }
          return new Type({ ...current.toJSON(), meta: { ...current.meta, torrent: { ...current.meta.torrent, ...resolved, autoMatchContents: { checkedAt: now, nextAttemptAt: now + 15 * 60000 } } } });
        });
        return 1;
      }
    }
    return 0;
  }, { ttlMs: 30000, waitMs: 0 });
}

function start() {
  const config = require("../config");
  const { UPLOADS, Upload } = require("../upload");
  const { LINKS, Link } = require("../links");
  const { catalog, applyAutomaticMatch } = require("./library");

  const sources = [{ map: UPLOADS, Type: Upload, kind: "file" }, { map: LINKS, Type: Link, kind: "link" }];
  let running = false; let scheduled; let lastContentsCheck = 0;
  const schedule = () => {
    if (!scheduled && !running) {
      scheduled = setTimeout(tick, 2500); scheduled.unref();
    }
  };
  const tick = async () => {
    scheduled = null;
    if (running || config.get("movieAutoMatch") === false || !Object.values(catalog.providers).some(Boolean)) {
      return;
    }
    running = true;
    let count = 0;
    try {
      if (config.get("torrentDiscovery") !== false && Date.now() - lastContentsCheck >= 60000) {
        lastContentsCheck = Date.now();
        try {
          await refreshContents({ sources, enrich: require("../link-metadata").enrichTorrent });
        }
        catch (error) {
          if (![404, 409].includes(error.status)) {
            console.warn("Torrent contents lookup will retry later.", error.name || "Error");
          }
        }
      }
      count = await runBatch({ sources, catalog, apply: applyAutomaticMatch });
    }
    catch (error) {
      if (error.status !== 409) {
        console.error("Automatic video matching will retry on the next maintenance pass.", error.name || "Error");
      }
    }
    finally {
      running = false;
    }
    if (count === 2) {
      schedule();
    }
  };
  for (const { map } of sources) {
    map.on("set", schedule); map.on("update", schedule);
  }
  const timer = setInterval(schedule, 60000); timer.unref(); schedule();
}

module.exports = { normalizeTitle, matchInput, confidentSelection, pendingVideos, matchVideo, runBatch, refreshContents, start };
