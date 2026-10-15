"use strict";

const { matchInput, confidentSelection, matchVideo, pendingVideos, runBatch, refreshContents } = require("../../lib/media/auto-match");
const { fittedPlayerWidth } = require("../../common/video");

const movie = { provider: "tmdb", id: "1", title: "Example", year: "2020", kind: "movie" };
const catalog = candidates => ({ search: jest.fn(async () => ({ candidates })), resolve: jest.fn(async candidate => candidate) });

test("automatic movie matching requires an exact, unique title and edition", async () => {
  const api = catalog([movie, { ...movie, id: "2", year: "1999" }]);
  expect(await matchVideo("Example.2020.1080p.mp4", "Example", api)).toMatchObject({ movie, basis: "title-year" });
  expect(confidentSelection(matchInput("Example.mp4", "Example"), [movie])).toBeNull();
  expect(confidentSelection(matchInput("Example.2020.mp4", "Example"), [movie, { ...movie, id: "3" }])).toBeNull();
  expect(confidentSelection(matchInput("Different.2020.mp4", "Example"), [movie])).toBeNull();
});

test("a bare movie title needs agreement from two catalogues without competing editions", async () => {
  const tvdb = { ...movie, provider: "tvdb", id: "9" };
  expect(await matchVideo("Example.mp4", "Example", catalog([movie, tvdb]))).toMatchObject({ movie, basis: "catalogue-agreement" });
  expect(await matchVideo("Example.mp4", "Example", catalog([movie, tvdb, { ...movie, id: "2", year: "1999" }]))).toMatchObject({ reason: "ambiguous" });
});

test("episode matching verifies exact series, season and episode, including specials", async () => {
  const candidate = { ...movie, kind: "episode", title: "Example", season: 0, episode: 2 };
  const api = catalog([candidate]); api.resolve = jest.fn(async () => ({ ...candidate, series: "Example", title: "Special title" }));
  expect(await matchVideo("Example.S00E02.mkv", "Example", api)).toMatchObject({ movie: { series: "Example", season: 0, episode: 2 }, basis: "series-episode" });
  api.resolve = jest.fn(async () => ({ ...candidate, series: "Wrong series" }));
  expect(await matchVideo("Example.S00E02.mkv", "Example", api)).toMatchObject({ reason: "ambiguous" });
  expect(matchInput("S01E03.mkv", "Example.Season.1.COMPLETE")).toMatchObject({ query: "Example", season: 1, episode: 3 });
});

test("samples and combined episodes stay available for review rather than receiving a false match", async () => {
  const api = catalog([movie]);
  expect(await matchVideo("sample.mp4", "Example.2020", api)).toMatchObject({ reason: "special-content" });
  expect(await matchVideo("Example.S01E01E02.mkv", "Example", api)).toMatchObject({ reason: "special-content" });
  expect(api.search).not.toHaveBeenCalled();
});

test("the durable queue covers every video, skips manual choices and respects retry times", () => {
  const now = Date.now();
  const map = new Map([["torrent", { expires: now + 60000, meta: { torrent: { files: [{ path: "a.mp4" }, { path: "b.mkv" }, { path: "notes.txt" }, { path: "c.webm" }] }, cinema: { 0: { autoMatch: { state: "manual" } } } } }]]);
  expect(pendingVideos([{ map, kind: "file" }], now).map(job => job.reference.index)).toEqual([1, 3]);
  map.get("torrent").meta.cinema[1] = { autoMatch: { state: "retry", nextAttemptAt: now + 1 } };
  expect(pendingVideos([{ map, kind: "link" }], now)).toHaveLength(1);
  map.get("torrent").expires = now;
  expect(pendingVideos([{ map, kind: "file" }], now)).toHaveLength(0);
});

test("provider failures back off and stop after three attempts", async () => {
  const now = Date.now();
  const item = { expires: now + 60000, meta: { torrent: { infoHashV1: "a".repeat(40), name: "Example", files: [{ path: "Example.2020.mp4" }] } } };
  const map = new Map([["key", item]]); map.getFresh = async key => map.get(key);
  const api = { search: jest.fn(async () => {
    throw new Error("provider offline");
  }) };
  const apply = jest.fn(async (_reference, _expected, result) => {
    item.meta.cinema = { 0: result };
  });
  const lease = (_key, action) => action(async () => {});
  await runBatch({ sources: [{ map, kind: "file" }], catalog: api, apply, lease, now });
  expect(item.meta.cinema[0].autoMatch).toMatchObject({ state: "retry", attempts: 1, nextAttemptAt: now + 300000 });
  item.meta.cinema[0].autoMatch = { state: "retry", attempts: 2, nextAttemptAt: now };
  await runBatch({ sources: [{ map, kind: "file" }], catalog: api, apply, lease, now });
  expect(item.meta.cinema[0].autoMatch).toMatchObject({ state: "review", attempts: 3 });
  await runBatch({ sources: [{ map, kind: "file" }], catalog: api, apply, lease, now });
  expect(api.search).toHaveBeenCalledTimes(2);
});

test("player width follows video proportions and available height without stretching the frame", () => {
  expect(fittedPlayerWidth(1920, 1080, 1000, 800, 200)).toBe(976);
  expect(fittedPlayerWidth(1080, 1920, 1000, 800, 200)).toBe(348);
  expect(fittedPlayerWidth(1920, 800, 320, 780, 300)).toBe(296);
  expect(fittedPlayerWidth(0, 0, 320, 780, 300)).toBeNull();
});

test("unresolved magnets receive bounded metadata retries before title matching", async () => {
  class Item {
    constructor(data) {
      Object.assign(this, data);
    } toJSON() {
      return { ...this };
    }
  }

  const now = Date.now(); const torrent = { infoHashV1: "a".repeat(40), trackers: [] };
  const map = new Map([["magnet", new Item({ expires: now + 60000, meta: { torrent } })]]);
  map.updateAtomic = async (key, update) => map.set(key, update(map.get(key)));
  const enrich = jest.fn(async value => ({ ...value, files: [{ path: "Example.2020.mp4", size: 10 }] }));
  const lease = (_key, action) => action(async () => {});
  await refreshContents({ sources: [{ map, Type: Item }], enrich, lease, now });
  expect(enrich).toHaveBeenCalledTimes(1);
  expect(pendingVideos([{ map, kind: "link" }], now)).toHaveLength(1);
  await refreshContents({ sources: [{ map, Type: Item }], enrich, lease, now });
  expect(enrich).toHaveBeenCalledTimes(1);
});
