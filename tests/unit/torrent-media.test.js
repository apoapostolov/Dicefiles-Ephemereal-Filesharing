"use strict";

const { filenameQuery } = require("../../common/video");
const { mediaFileTitle, torrentContentsSize, episodePack, torrentMedia } = require("../../common/torrent-media");
const { matchInput, matchVideo } = require("../../lib/media/auto-match");
const { MediaCatalog } = require("../../lib/media/catalog");

const series = { provider: "tmdb", seriesId: "1", series: "The Brink", title: "Pilot", kind: "episode", season: 1, episode: 1, seriesYear: "2015", seriesEnded: true, seriesSeasons: [{ season: 1, episodes: 10 }] };
const season = (number, count) => Array.from({ length: count }, (_, index) => ({ path: `Season ${number}/The.Brink.S${String(number).padStart(2, "0")}E${String(index + 1).padStart(2, "0")}.mkv`, size: 1000 }));

test("recognized movie and episode display names preserve originals as fallbacks", () => {
  expect(mediaFileTitle({ title: "Example", kind: "movie", year: 2020 }, "original.torrent")).toBe("Example (2020)");
  expect(mediaFileTitle(series, "release.mkv")).toBe("The Brink · Season 1 Episode 1");
  expect(mediaFileTitle({ ...series, season: 0 }, "special.mkv")).toBe("The Brink · Special Episode 1");
  expect(mediaFileTitle(null, "original.mkv")).toBe("original.mkv");
});

test.each([
  ["Show_Name_S02E03.mkv", "", "Show Name", 2, 3],
  ["Season 1/E01.mkv", "The Brink (2015) Season 1 S01", "The Brink", 1, 1],
  ["The Brink/Season 2/03 - Pilot.mkv", "The Brink Complete", "The Brink", 2, 3],
  ["E02.mkv", "The Brink (2015) Season 1 S01", "The Brink", 1, 2],
  ["Show.S01E01-E02.mkv", "Show", "Show", 1, 1],
])("episode identity resolves %s in its pack context", (path, parent, query, season, episode) => {
  expect(filenameQuery(path, parent)).toMatchObject({ query, season, episode });
});

test("ambiguous season context never guesses a season for bare episode numbers", () => {
  expect(filenameQuery("E01.mkv", "Show Complete S01-S03").season).toBeNull();
});

test("the supplied season-pack naming pattern groups E01 through E10 and verifies contents", () => {
  const torrent = { name: "The Brink (2015) Season 1 S01 (1080p AMZN WEBRip x265 HEVC 10bit AAC 5.1 Silence", files: season(1, 10) };
  expect(episodePack(torrent, { 0: { movie: series } })).toMatchObject({ type: "season-pack", totalEpisodes: 10, completeSeries: true, groups: [{ season: 1, complete: true, contiguous: true, expected: 10 }] });
  expect(torrentMedia(torrent, { 0: { movie: series } }).title).toContain("The Brink");
  expect(torrentMedia(torrent, { 0: { movie: series } }).title).toContain("Season 1");
  expect(torrentMedia(torrent, {})).toBeNull();
});

test("multi-season and complete-series packs validate every regular season", () => {
  const torrent = { name: "The Brink Complete S01-S02", files: [...season(1, 10), ...season(2, 4), { path: "Extras/Trailer.mp4", size: 100 }] };
  const movie = { ...series, seriesSeasons: [{ season: 1, episodes: 10 }, { season: 2, episodes: 4 }] };
  expect(torrentMedia(torrent, { 0: { movie } })).toMatchObject({ type: "series-pack", completeSeries: true, totalEpisodes: 14, title: "The Brink · Complete series · Seasons 1–2" });
  expect(torrentMedia(torrent, { 0: { movie: { ...movie, seriesEnded: false } } }).completeSeries).toBe(false);
  const partial = { ...torrent, files: torrent.files.filter(file => !file.path.includes("S02E03")) };
  expect(torrentMedia(partial, { 0: { movie } })).toMatchObject({ type: "series-pack", completeSeries: false });
  expect(torrentMedia(partial, { 0: { movie } }).summary).toContain("Gaps");
  const unknown = { ...series, seriesSeasons: undefined };
  expect(torrentMedia(torrent, { 0: { movie: unknown } }).summary).toContain("unverified");
});

test("duplicates, specials and combined-episode files do not inflate episode coverage", () => {
  const torrent = { name: "The Brink S01", files: [{ path: "The.Brink.S01E01-E02.mkv", size: 200 }, { path: "The.Brink.S01E02.mkv", size: 100 }, { path: "The.Brink.S00E01.mkv", size: 10 }] };
  expect(episodePack(torrent, { 0: { movie: series } })).toMatchObject({ totalEpisodes: 3, groups: [{ season: 0, episodes: [1] }, { season: 1, episodes: [1, 2] }] });
  expect(torrentMedia(torrent, { 0: { movie: series } }).completeSeries).toBe(false);
});

test("mixed shows and unrelated movies retain the torrent's original title", () => {
  const torrent = { name: "Mixed", files: [...season(1, 2)] };
  expect(torrentMedia(torrent, { 0: { movie: series }, 1: { movie: { ...series, series: "Other show", episode: 2 } } })).toBeNull();
  expect(torrentMedia({ name: "Movies", files: [{ path: "first.mp4", size: 100 }, { path: "second.mp4", size: 100 }] }, { 0: { movie: { title: "First", kind: "movie", year: "2020" } } })).toBeNull();
});

test("contents size sums files, never substitutes descriptor bytes, and handles unknown safely", () => {
  expect(torrentContentsSize({ totalSize: 999, files: [{ size: 100 }, { size: 200 }] })).toBe(300);
  expect(torrentContentsSize({ totalSize: 5000, files: [] })).toBe(5000);
  expect(torrentContentsSize({ files: [] })).toBeNull();
  expect(torrentContentsSize({ totalSize: -1, files: [{ size: Number.MAX_SAFE_INTEGER }, { size: Number.MAX_SAFE_INTEGER }] })).toBeNull();
  expect(torrentMedia({ files: [{ path: "Movie.2020.mp4", size: 123 }] }, { 0: { movie: { title: "Movie", year: 2020, kind: "movie" } } }).title).toBe("Movie (2020)");
});

test("background matching passes inferred episode identity to provider search", async () => {
  const candidate = { ...series, id: "1", title: "The Brink", year: "2015" };
  const catalog = { search: jest.fn(async () => ({ candidates: [candidate] })), resolve: jest.fn(async () => series) };
  expect(matchInput("E01.mkv", "The Brink (2015) Season 1 S01")).toMatchObject({ query: "The Brink", year: 2015, season: 1, episode: 1 });
  expect((await matchVideo("E01.mkv", "The Brink (2015) Season 1 S01", catalog)).movie).toBe(series);
  expect(catalog.search.mock.calls[0][0]).toContain("S01E01");
});

test("catalogue episodes retain series coverage and reuse series requests across a season", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const number = Number(/\/episode\/(\d+)/.exec(url)?.[1]);
    return new Response(JSON.stringify(number ? { id: 100 + number, name: `Episode ${number}`, season_number: 1, episode_number: number, air_date: "2015-06-21" } : { id: 1, name: "The Brink", status: "Canceled", first_air_date: "2015-06-21", seasons: [{ season_number: 1, episode_count: 10 }] }));
  };
  const catalog = new MediaCatalog(new Map([["tmdbToken", "synthetic-token"]]), fetcher);
  expect(await catalog.resolve({ provider: "tmdb", id: "1", kind: "episode", season: 1, episode: 1 })).toMatchObject({ series: "The Brink", seriesId: "1", seriesYear: "2015", seriesEnded: true, seriesSeasons: [{ season: 1, episodes: 10 }] });
  await catalog.resolve({ provider: "tmdb", id: "1", kind: "episode", season: 1, episode: 2 });
  expect(calls).toHaveLength(3);
});

test("old ambiguous season episodes get one parser migration retry; manual choices stay untouched", () => {
  const { pendingVideos } = require("../../lib/media/auto-match");

  const now = Date.now();
  const item = { expires: now + 10000, meta: { torrent: { name: "The Brink (2015) Season 1 S01", files: [{ path: "E01.mkv" }, { path: "E02.mkv" }] }, cinema: { 0: { autoMatch: { state: "review", reason: "ambiguous" } }, 1: { autoMatch: { state: "manual" } } } } };
  const sources = [{ kind: "file", map: new Map([["test", item]]) }];
  expect(pendingVideos(sources, now)).toHaveLength(1);
  item.meta.cinema[0].autoMatch.parserVersion = 2;
  expect(pendingVideos(sources, now)).toHaveLength(0);
});
