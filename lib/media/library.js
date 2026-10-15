"use strict";

const { DistributedMap } = require("../broker/collections");
const CONFIG = require("../config");
const { withLease } = require("../redis-lease");
const { randomUUID } = require("node:crypto");
const { MediaCatalog } = require("./catalog");
const { normalizeSubtitle } = require("./subtitles");
const { durationSeconds, watchKey } = require("../../common/video");

const RECORDS = new DistributedMap("media-library");
const catalog = new MediaCatalog(CONFIG);
const MAX_RECORDS = 10000;

function validateReference(reference) {
  if (!reference || !["file", "link"].includes(reference.kind) || typeof reference.key !== "string" || !/^[\w-]{1,80}$/.test(reference.key) || !Number.isInteger(reference.index) || reference.index < -1 || reference.index > 1999) {
    throw new Error("Invalid video selection. Refresh the room and open the video again.");
  }
  return watchKey(reference, reference.index);
}

async function resolveReference(reference, client) {
  validateReference(reference);
  let item;
  if (reference.kind === "file") {
    const visible = await client.room.files.for(client.role, client.ip);
    if (!visible.some(file => file.key === reference.key)) {
      throw new Error("This video is no longer available. Refresh the room and try again.");
    }
    item = await require("../upload").Upload.get(reference.key);
  }
  else {
    item = await require("../links").Link.get(reference.key);
    if (item?.roomid !== client.roomid) {
      item = null;
    }
  }
  if (!item || item.expired) {
    throw new Error("This video is no longer available. Refresh the room and try again.");
  }
  let {name} = item; let torrent = item.meta?.torrent;
  if (reference.index >= 0) {
    if (torrent && !torrent.files?.length) {
      torrent = await require("../link-metadata").enrichTorrent(torrent, { discovery: true });
    }
    const file = torrent?.files?.[reference.index];
    if (!file || !/\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts)$/i.test(file.path || file.name || "")) {
      throw new Error("Choose a video from the torrent contents. Refresh its file list if needed.");
    }
    name = file.path || file.name;
  }
  else if (item.type !== "video") {
    throw new Error("Choose a video file or a video inside a torrent.");
  }
  const editable = client.role === "mod" || item.ip === client.ip || client.user?.account && item.meta?.account === client.user.account || client.owner;
  return { item, name, torrent, editable: !!editable };
}

function publicRecord(record) {
  return { movie: record?.movie || null, subtitles: (record?.subtitles || []).map(({ text, ...track }) => track), ...(record?.autoMatch ? { autoMatch: record.autoMatch } : {}) };
}

async function mutate(reference, item, action, guard) {
  const key = validateReference(reference);
  return withLease("lock:media-library", async assertOwned => {
    await RECORDS.loaded;
    if (!await RECORDS.getFresh(key) && (await RECORDS.entriesFresh()).length >= MAX_RECORDS) {
      throw new Error("The media library is full. Ask the site operator to remove expired entries.");
    }
    const previous = await RECORDS.getFresh(key);
    const record = { autoMatch: item.meta?.cinema?.[reference.index]?.autoMatch, ...(previous || {}), expires: item.expires };
    await action(record);
    await assertOwned();
    if (!previous) {
      await RECORDS.setDurable(key, { expires: item.expires });
    }
    await RECORDS.updateAtomic(key, () => record, guard);
    const summary = publicRecord(record);
    const { UPLOADS, Upload } = require("../upload");

    if (reference.kind === "file") {
      await UPLOADS.updateAtomic(item.key, current => new Upload({ ...current.toJSON(), meta: { ...current.meta, cinema: { ...current.meta.cinema, [reference.index]: summary } } }), guard);
    }
    else {
      const { LINKS, Link } = require("../links");

      await LINKS.updateAtomic(item.id, current => new Link({ ...current.toJSON(), meta: { ...current.meta, cinema: { ...current.meta.cinema, [reference.index]: summary } } }), guard);
    }
    return publicRecord(record);
  });
}

async function mediaAction(client, reference, operation, input) {
  const policy = await client.room.config.getFresh("passwordAccess");
  const guard = { map: `map:rco:${client.roomid}`, field: JSON.stringify({ v: "passwordAccess" }), raw: policy === undefined ? "" : JSON.stringify(policy) };
  if (!client.socket || !client.invited || client.disabled || !await client.room.passwordAccessAllowed(client.user, client.token, client.socket.handshake.cookies || {})) {
    throw new Error("Your session has expired. Refresh the room and sign in again.");
  }
  const { item, name, editable } = await resolveReference(reference, client);
  await RECORDS.loaded;
  const key = validateReference(reference);
  if (operation === "get") {
    const record = await RECORDS.getFresh(key);
    return { ...publicRecord(record), autoMatch: record?.autoMatch || item.meta?.cinema?.[reference.index]?.autoMatch || null, autoMatchEnabled: CONFIG.get("movieAutoMatch") !== false, editable, providers: catalog.providers, torrentPlayback: CONFIG.get("torrentPlayback") !== false, duration: durationSeconds(item.meta?.durationSeconds || item.meta?.duration), name };
  }
  const [count] = await require("../broker").getMethods("ratelimit").ratelimit(`rl:media:${client.ip}`, 60000);
  if (Number(count) > 15) {
    throw new Error("Too many movie requests. Wait one minute and try again.");
  }
  if (operation === "search") {
    if (input !== undefined && (typeof input !== "string" || input.length > 150)) {
      throw new Error("Enter a title shorter than 150 characters.");
    }
    return catalog.search(name, input);
  }
  if (operation === "preview") {
    return { movie: await catalog.resolve(input) };
  }
  if (!editable) {
    throw new Error("Only the uploader or a room moderator can change movie details or subtitles. Ask them to update this video.");
  }
  await client.checkUploadAccess();
  if (operation === "match") {
    const movie = await catalog.resolve(input);
    return mutate(reference, item, record => {
      record.movie = movie;
      record.autoMatch = { state: "manual", checkedAt: Date.now() };
    }, guard);
  }
  if (operation === "unmatch") {
    return mutate(reference, item, record => {
      delete record.movie;
      record.autoMatch = { state: "manual", checkedAt: Date.now() };
    }, guard);
  }
  if (operation === "subtitle") {
    const normalized = normalizeSubtitle(input?.text, input?.language);
    return mutate(reference, item, record => {
      const tracks = [...(record.subtitles || [])];
      if (tracks.length >= 4) {
        throw new Error("This video already has four subtitle tracks. Remove a track before adding another.");
      }
      tracks.push({ ...normalized, id: randomUUID(), label: `${normalized.label}${input?.hearingImpaired ? " · SDH" : ""}` }); record.subtitles = tracks;
    }, guard);
  }
  if (operation === "remove-subtitle") {
    if (typeof input !== "string" || !/^[\da-f-]{36}$/.test(input)) {
      throw new Error("Invalid subtitle selection. Refresh the video details and try again.");
    }
    return mutate(reference, item, record => {
      record.subtitles = (record.subtitles || []).filter(track => track.id !== input);
    }, guard);
  }
  throw new Error("Unsupported video action. Refresh the room and try again.");
}

async function applyAutomaticMatch(reference, expected, result) {
  const recordKey = validateReference(reference);
  const { map, Type } = reference.kind === "file" ? (() => {
    const { UPLOADS, Upload } = require("../upload");

    return { map: UPLOADS, Type: Upload };
  })() : (() => {
    const { LINKS, Link } = require("../links");

    return { map: LINKS, Type: Link };
  })();
  return withLease("lock:media-library", async assertOwned => {
    const item = await map.getFresh(reference.key);
    const torrent = item?.meta?.torrent;
    if (!item || item.expires <= Date.now() || torrent?.files?.[reference.index]?.path !== expected.path || (torrent.infoHashV1 || torrent.infoHashV2) !== expected.hash) {
      return false;
    }
    const previous = await RECORDS.getFresh(recordKey);
    const summary = item.meta.cinema?.[reference.index] || {};
    // User choices, including an explicit removal, always win a race with lookup.
    if (previous?.movie || previous?.autoMatch?.state === "manual" || summary.movie || summary.autoMatch?.state === "manual") {
      return false;
    }
    let record = previous;
    if (result.movie) {
      if (!previous && (await RECORDS.entriesFresh()).length >= MAX_RECORDS) {
        result = { autoMatch: { ...result.autoMatch, state: "review", reason: "library-full" } };
      }
      else {
        record = { ...previous, movie: result.movie, autoMatch: result.autoMatch, expires: item.expires };
        await assertOwned(); await RECORDS.setDurable(recordKey, record);
      }
    }
    await assertOwned();
    await map.updateAtomic(reference.key, current => {
      const latest = current.meta?.cinema?.[reference.index] || {};
      if (current.expires <= Date.now() || current.meta?.torrent?.files?.[reference.index]?.path !== expected.path || (current.meta?.torrent?.infoHashV1 || current.meta?.torrent?.infoHashV2) !== expected.hash || latest.movie || latest.autoMatch?.state === "manual") {
        throw Object.assign(new Error("Video changed during automatic matching"), { status: 409 });
      }
      const next = { ...latest, ...publicRecord(record), autoMatch: result.autoMatch };
      return new Type({ ...current.toJSON(), meta: { ...current.meta, cinema: { ...current.meta.cinema, [reference.index]: next } } });
    });
    return true;
  });
}

const prune = setInterval(async () => {
  await RECORDS.loaded;
  for (const [key, record] of RECORDS) {
    if (record.expires < Date.now()) {
      RECORDS.delete(key);
    }
  }
}, 300000);
prune.unref();

module.exports = { RECORDS, catalog, validateReference, resolveReference, publicRecord, mediaAction, applyAutomaticMatch };
