"use strict";

const { torrentWatchTarget } = require("../../common/torrent-media");
const { saveWatch, watchRecords, watchCompleted, episodeIdentity, watchKey, WATCH_PREFIX } = require("../../common/video");

const reference = { kind: "link", key: "synthetic" };
const file = (path, size = 1000) => ({ path, size });
const pack = { name: "Show Complete", files: [file("Show.S02E01.mkv"), file("Show.S01E10.mkv"), file("notes.txt"), file("Show.S01E02.mkv"), file("Show.S01E01.mkv"), file("Show.S00E01.mkv"), file("Extras/trailer.mp4", 9000)] };
const history = (index, position, duration = 1000) => ({ key: watchKey(reference, index), position, duration, completed: false });

function storage() {
  const rows = new Map();
  return { get length() {
    return rows.size;
  }, key: index => [...rows.keys()][index], getItem: key => rows.get(key), setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}

test("movies choose the largest main video and retain its original file index", () => {
  const torrent = { files: [file("trailer.mp4", 99999), file("notes.pdf", 99999), file("Small.mkv", 10), file("Movie.mkv", 1000)] };
  expect(torrentWatchTarget(torrent, {}, reference)).toMatchObject({ index: 3, replay: false });
  expect(torrentWatchTarget({ files: [file("book.pdf")] }, {}, reference)).toBeNull();
  expect(torrentWatchTarget(torrent, {}, null)).toBeNull();
});

test("packs use numeric season/episode order, skip 90% legacy records, and preserve unfinished timestamps", () => {
  expect(torrentWatchTarget(pack, {}, reference).index).toBe(4);
  const partial = history(3, 450);
  expect(torrentWatchTarget(pack, {}, reference, [history(4, 900), partial])).toMatchObject({ index: 3, progress: { position: 450 }, replay: false });
  expect(torrentWatchTarget(pack, {}, reference, [history(4, 899)])).toMatchObject({ index: 4 });
  expect(torrentWatchTarget(pack, {}, reference, [history(4, 900), history(3, 950), history(1, 999)])).toMatchObject({ index: 0 });
});

test("specials follow regular seasons and all-watched packs offer replay from the first episode", () => {
  const regular = [0, 1, 3, 4].map(index => history(index, 950));
  expect(torrentWatchTarget(pack, {}, reference, regular)).toMatchObject({ index: 5, replay: false });
  expect(torrentWatchTarget(pack, {}, reference, [...regular, history(5, 950)])).toMatchObject({ index: 4, replay: true });
});

test("matches and parent season folders support episode filenames without SxxExx", () => {
  const torrent = { name: "Show Season 3", files: [file("E02.mkv"), file("E01.mkv")] };
  expect(torrentWatchTarget(torrent, {}, reference).index).toBe(1);
  const cinema = { 0: { movie: { kind: "episode", title: "Second", series: "Show", season: 2, episode: 2 } }, 1: { movie: { kind: "episode", title: "First", series: "Show", season: 2, episode: 1 } } };
  expect(torrentWatchTarget({ files: [file("release-a.mkv"), file("release-b.mkv")] }, cinema, reference).index).toBe(1);
});

test("watched duplicate encodes do not cause the same episode to play again", () => {
  const torrent = { files: [file("Show.S01E01.720p.mkv"), file("Show.S01E01.1080p.mkv", 2000), file("Show.S01E02.mkv")] };
  expect(torrentWatchTarget(torrent, {}, reference, [history(0, 910)])).toMatchObject({ index: 2 });
  expect(torrentWatchTarget(torrent, {}, { kind: "file", key: "synthetic" }, [history(0, 910)]).index).toBe(1);
});

test("episode completion persists at 90%, survives replay, and supports short episodes", () => {
  const saved = storage(); const key = watchKey(reference, 4);
  expect(saveWatch(saved, key, 899, 1000, 1000, true)).toBe(true);
  expect(watchRecords(saved, 1001)[0].completed).toBe(false);
  saveWatch(saved, key, 900, 1000, 1002, true);
  expect(watchRecords(saved, 1003)[0]).toMatchObject({ completed: true, episode: true });
  saveWatch(saved, key, 20, 1000, 1004, true);
  expect(watchRecords(saved, 1005)[0].completed).toBe(true);
  saveWatch(saved, "short", 270, 300, 1006, true);
  expect(watchRecords(saved, 1007)[0]).toMatchObject({ key: "short", completed: true });
  expect(saveWatch(saved, "short-movie", 270, 300, 1008)).toBe(false);
});

test("legacy 90% progress is treated as watched for episodes but movies retain their completion policy", () => {
  const legacy = history(4, 910);
  expect(watchCompleted(legacy, true)).toBe(true); expect(watchCompleted(legacy)).toBe(false);
  const saved = storage(); saved.setItem(WATCH_PREFIX + legacy.key, JSON.stringify({ ...legacy, updatedAt: 1000 }));
  saveWatch(saved, legacy.key, 10, 1000, 1001, true);
  expect(watchRecords(saved, 1002)[0].completed).toBe(true);
  expect(episodeIdentity("Movie.S01E02.mkv", { kind: "movie" })).toBeNull();
});
