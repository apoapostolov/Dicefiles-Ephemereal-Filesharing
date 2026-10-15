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

function filenameQuery(name) {
  const base = String(name || "").split(/[/\\]/).pop().replace(/\.[a-z0-9]{2,5}$/i, "");
  const episode = base.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\b/i) || base.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  const year = base.match(/\b((?:19|20)\d{2})\b/);
  return { query: base.split(/\b(?:S\d{1,2}[ ._-]*E\d{1,3}|\d{1,2}x\d{2,3}|(?:19|20)\d{2}|2160p|1080p|720p|480p|WEB[ ._-]*DL|BluRay|HDTV)\b/i)[0].replace(/[._]+/g, " ").trim().slice(0, 150), year: year ? Number(year[1]) : null, season: episode ? Number(episode[1]) : null, episode: episode ? Number(episode[2]) : null };
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

module.exports = { WATCH_PREFIX, LONG_VIDEO_SECONDS, durationSeconds, mediaTitle, filenameQuery, watchKey, saveWatch, watchRecords, timeLabel, fittedPlayerWidth };
