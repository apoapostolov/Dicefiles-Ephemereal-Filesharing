"use strict";

const WATCH_PREFIX = "dicefiles:watch:";
const LONG_VIDEO_SECONDS = 600;

function durationSeconds(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  const text = String(value || "").trim();
  if (/^\d+(?:\.\d+)?\s*s(?:ec(?:onds)?)?$/i.test(text)) {
    return Number.parseFloat(text);
  }
  if (/^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(text)) {
    return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : 0;
}

function mediaTitle(movie, fallback) {
  if (!movie?.title) {
    return fallback;
  }
  if (movie.kind === "episode") {
    const episode = movie.season === 0 ? `Special ${movie.episode}` : `S${String(movie.season).padStart(2, "0")}E${String(movie.episode).padStart(2, "0")}`;
    return `${movie.series || movie.title} · ${episode}${movie.series ? ` · ${movie.title}` : ""}`;
  }
  return `${movie.title}${movie.year ? ` (${movie.year})` : ""}`;
}

function filenameQuery(name, context = "") {
  const parts = String(name || "").split(/[/\\]/);
  const base = parts.pop().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._]+/g, " ");
  const episode = base.match(/\bS(\d{1,2})[ -]*E(\d{1,3})(?!\d)/i) || base.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  const seasonContext = [base, ...parts.slice().reverse(), String(context)].map(value => value.replace(/[._]+/g, " ")).find(value => {
    const seasons = [...value.matchAll(/\b(?:S|Season[ -]*)(\d{1,2})(?![\dE])/gi)].map(match => Number(match[1]));
    return seasons.length && new Set(seasons).size === 1;
  });
  const season = seasonContext?.match(/\b(?:S|Season[ -]*)(\d{1,2})(?![\dE])/i);
  const standaloneEpisode = !episode && (base.match(/\b(?:E|Episode[ -]*)(\d{1,3})(?!\d)/i) || season && base.match(/^(\d{1,3})(?:[ -]|$)/));
  const year = base.match(/\b((?:19|20)\d{2})\b/);
  const prefix = base.split(/\bS\d{1,2}[ -]*E\d{1,3}(?!\d)/i)[0];
  let query = prefix.split(/\b(?:S\d{1,2}|Season[ -]*\d{1,2}|E\d{1,3}|Episode[ -]*\d{1,3}|\d{1,2}x\d{2,3}|(?:19|20)\d{2}|2160p|1080p|720p|480p|576p|WEB[ -]*(?:DL|Rip)|BluRay|HDTV|COMPLETE|PACK)\b/i)[0].replace(/[()[\] -]+$/g, "").trim().slice(0, 150);
  if (standaloneEpisode && season) {
    const parent = parts.slice().reverse().find(value => filenameQuery(`${value}.mkv`).query.length > 1) || context;
    query = parent ? filenameQuery(`${parent}.mkv`).query : query;
  }
  return { query, year: year ? Number(year[1]) : null, season: episode ? Number(episode[1]) : standaloneEpisode && season ? Number(season[1]) : null, episode: episode ? Number(episode[2]) : standaloneEpisode && season ? Number(standaloneEpisode[1]) : null };
}

function watchKey(reference, index = -1) {
  return `${reference.kind}:${reference.key}:${index}`;
}

function saveWatch(storage, key, position, duration, now = Date.now()) {
  if (!key || !Number.isFinite(duration) || duration <= LONG_VIDEO_SECONDS || !Number.isFinite(position) || position < 0) {
    return false;
  }
  try {
    const completed = position >= duration - Math.min(30, duration * 0.02);
    storage.setItem(WATCH_PREFIX + key, JSON.stringify({ position: Math.min(position, duration), duration, updatedAt: now, completed }));
    return true;
  }
  catch (_) {
    return false;
  }
}

function watchRecords(storage, now = Date.now()) {
  const records = [];
  try {
    const remove = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(WATCH_PREFIX)) {
        continue;
      }
      try {
        const record = JSON.parse(storage.getItem(key));
        if (!Number.isFinite(record?.updatedAt) || now - record.updatedAt > 180 * 86400000 || !Number.isFinite(record.position) || !Number.isFinite(record.duration) || record.duration <= LONG_VIDEO_SECONDS) {
          remove.push(key); continue;
        }
        records.push({ ...record, key: key.slice(WATCH_PREFIX.length) });
      }
      catch (_) {
        remove.push(key);
      }
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    remove.push(...records.slice(1000).map(record => WATCH_PREFIX + record.key));
    remove.forEach(key => storage.removeItem(key));
    return records.slice(0, 1000);
  }
  catch (_) {
    return [];
  }
}

function timeLabel(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return value >= 3600 ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function fittedPlayerWidth(videoWidth, videoHeight, viewportWidth, viewportHeight, interfaceHeight, inset = 24) {
  if (![videoWidth, videoHeight, viewportWidth, viewportHeight, interfaceHeight, inset].every(Number.isFinite) || videoWidth <= 0 || videoHeight <= 0) {
    return null;
  }
  const available = Math.max(80, viewportHeight - interfaceHeight - 24);
  return Math.max(160, Math.floor(Math.min(1280, viewportWidth - 24, available * videoWidth / videoHeight + inset)));
}

function bufferingStatus(progress = {}, bufferedSeconds = 0) {
  const phase = progress.totalParts > 0 && progress.peers === 0 && !progress.bytesPerSecond ? "Waiting for video peers…" : { connecting: "Finding video peers…", inspecting: "Reading video information…", converting: "Preparing video…" }[progress.phase] || "Buffering video…";
  const details = [phase];
  if (progress.totalParts > 0) {
    details.push(`${progress.downloadedParts.toLocaleString()} / ${progress.totalParts.toLocaleString()} parts`);
  }
  else if (bufferedSeconds > 0) {
    details.push(`${Math.floor(bufferedSeconds)}s buffered`);
  }
  if (progress.totalParts > 0 || progress.bytesPerSecond > 0) {
    const speed = progress.bytesPerSecond || 0;
    details.push(speed >= 1024 ** 2 ? `${(speed / 1024 ** 2).toFixed(1)} MiB/s` : `${Math.round(speed / 1024)} KiB/s`);
  }
  if (progress.etaSeconds > 0) {
    const seconds = Math.ceil(progress.etaSeconds);
    details.push(`~${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`} to buffer`);
  }
  else {
    details.push(progress.phase === "converting" ? "Preparing playback…" : "Estimating start…");
  }
  return details.join(" · ");
}

module.exports = { WATCH_PREFIX, LONG_VIDEO_SECONDS, durationSeconds, mediaTitle, filenameQuery, watchKey, saveWatch, watchRecords, timeLabel, fittedPlayerWidth, bufferingStatus };
