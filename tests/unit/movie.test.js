"use strict";

const { durationSeconds, filenameQuery, mediaTitle, saveWatch, watchRecords, WATCH_PREFIX, watchKey } = require("../../common/video");
const { normalizeSubtitle } = require("../../lib/media/subtitles");
const { MediaCatalog, parseMediaPage } = require("../../lib/media/catalog");
const { PieceStore, parseRange, validRelay } = require("../../lib/media/torrent-stream");

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  get length() {
    return this.data.size;
  }
  key(index) {
    return [...this.data.keys()][index];
  }
  getItem(key) {
    return this.data.get(key);
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

test.each([[601, 601], ["0:10:01", 601], ["10:01", 601], ["601 s", 601], ["1:23:45.5", 5025.5], ["", 0], [Infinity, 0], [-20, 0]])("duration %s normalizes to seconds", (input, output) => {
  expect(durationSeconds(input)).toBe(output);
});

test("movie and episode filenames become sensible queries without an automatic match", () => {
  expect(filenameQuery("Example.Show.S00E03.1080p.WEB-DL.mkv")).toMatchObject({ query: "Example Show", season: 0, episode: 3 });
  expect(filenameQuery("Some.Movie.2010.720p.mp4")).toMatchObject({ query: "Some Movie", year: 2010, season: null });
  expect(mediaTitle({ kind: "episode", series: "Series", title: "Pilot", season: 0, episode: 1 })).toBe("Series · Special 1 · Pilot");
  expect(mediaTitle({ kind: "movie", title: "Movie", year: 2020 })).toBe("Movie (2020)");
});

test("watch progress strictly excludes ten minutes and resumes long videos with bounded history", () => {
  const storage = new MemoryStorage(); const key = watchKey({ kind: "file", key: "synthetic" }, -1);
  expect(saveWatch(storage, key, 10, 600)).toBe(false);
  expect(saveWatch(storage, key, NaN, 601)).toBe(false);
  expect(saveWatch(storage, key, 50, 601, 100)).toBe(true);
  expect(watchRecords(storage, 200)[0]).toMatchObject({ key, position: 50, duration: 601, completed: false });
  const record = JSON.parse(storage.getItem(WATCH_PREFIX + key)); record.dismissed = true; storage.setItem(WATCH_PREFIX + key, JSON.stringify(record));
  saveWatch(storage, key, 55, 601, 200);
  expect(watchRecords(storage, 201)[0].dismissed).toBeUndefined();
  saveWatch(storage, key, 600, 601, 300);
  expect(watchRecords(storage, 301)[0].completed).toBe(true);
  expect(watchRecords(storage, 181 * 86400000)).toEqual([]);
  expect(storage.length).toBe(0);
});

test("invalid and excessive watch records cannot corrupt other rooms or private browsing", () => {
  const storage = new MemoryStorage(); storage.setItem("reader-other", "keep"); storage.setItem(`${WATCH_PREFIX}bad`, "{");
  for (let i = 0; i < 1005; i++) {
    saveWatch(storage, String(i), 20, 800, 1000 + i);
  }
  expect(watchRecords(storage, 3000)).toHaveLength(1000); expect(storage.getItem("reader-other")).toBe("keep");
  expect(saveWatch({ setItem() {
    throw new Error("blocked");
  } }, "f", 20, 800)).toBe(false);
});

test("subtitles convert SRT to plain WebVTT with assigned language", () => {
  const result = normalizeSubtitle("1\r\n00:00:01,000 --> 00:00:03,000\r\n<b>Hello</b><script>alert</script>\r\n", "uk");
  expect(result.language).toBe("uk"); expect(result.label).toBe("Ukrainian"); expect(result.text).toContain("00:00:01.000 --> 00:00:03.000"); expect(result.text).not.toContain("<");
});

test.each([
  ["WEBVTT\n\n00:01.000 --> 00:02.000\nhello", "bogus_language"],
  ["WEBVTT\n\n00:02.000 --> 00:01.000\nhello", "en"],
  ["WEBVTT\n\nSTYLE\n::cue {color:red}", "en"],
  ["x".repeat(262145), "en"],
  ["\u0000WEBVTT", "en"],
])("invalid subtitle input is rejected %#", (text, language) => {
  expect(() => normalizeSubtitle(text, language)).toThrow();
});

test("provider page parser accepts exact movie/episode routes and rejects arbitrary destinations", () => {
  expect(parseMediaPage("https://www.imdb.com/title/tt1234567/?ref_=x")).toEqual({ provider: "imdb", id: "tt1234567" });
  expect(parseMediaPage("https://trakt.tv/shows/example/seasons/0/episodes/1")).toMatchObject({ kind: "episode", season: 0, episode: 1 });
  expect(parseMediaPage("https://thetvdb.com/series/example/episodes/42")).toMatchObject({ kind: "episode", id: "42" });
  for (const url of ["http://imdb.com/title/tt1234567", "https://imdb.com.evil.test/title/tt1234567", "https://user:pass@imdb.com/title/tt1234567", "https://localhost/movie", "file:///secret", "https://imdb.com/title/tt1234567/extra"]) {
    expect(() => parseMediaPage(url)).toThrow();
  }
});

test("catalog searches configured services, lists uncertainty and isolates provider failures", async () => {
  const config = new Map([["tmdbToken", "synthetic-secret"], ["tvdbApiKey", "synthetic-tvdb"]]);
  const fetcher = jest.fn(async (url, init) => {
    if (url.includes("thetvdb")) {
      return new Response("{}", { status: 403 });
    }
    expect(init.headers.Authorization).toBe("Bearer synthetic-secret");
    return new Response(JSON.stringify({ results: [{ id: 1, title: "Example", media_type: "movie", release_date: "2020-01-01" }, { id: 2, name: "Example", media_type: "tv" }] }));
  });
  const catalog = new MediaCatalog(config, fetcher); const result = await catalog.search("Example.S01E02.mkv");
  expect(result.candidates).toHaveLength(2); expect(result.candidates[1]).toMatchObject({ kind: "episode", season: 1, episode: 2 });
  expect(result.warnings).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  await catalog.search("Example.S01E02.mkv"); expect(fetcher).toHaveBeenCalledTimes(2);
});

test("confirmed TMDB title returns safe artwork, trailer, cast, and attribution", async () => {
  const catalog = new MediaCatalog(new Map([["tmdbToken", "private"]]), jest.fn(async () => new Response(JSON.stringify({ id: 1, title: "Example", release_date: "2020-01-01", overview: "<b>Story</b>", poster_path: "/poster.jpg", backdrop_path: "/back.jpg", genres: [{ name: "Drama" }], vote_count: 4, vote_average: 8.1, images: { logos: [{ file_path: "/logo.png", iso_639_1: "en" }], backdrops: [{ file_path: "/scene.jpg" }] }, credits: { cast: [{ id: 1, name: "Actor", character: "Character", profile_path: "/actor.jpg" }] }, videos: { results: [{ site: "YouTube", type: "Trailer", key: "abcdefghijk" }] } }))));
  const movie = await catalog.resolve({ provider: "tmdb", id: "1", kind: "movie" });
  expect(movie).toMatchObject({ title: "Example", year: "2020", overview: "Story", trailer: "https://www.youtube.com/watch?v=abcdefghijk" });
  expect(movie.logo).toContain("image.tmdb.org"); expect(movie.cast).toHaveLength(1); expect(movie.attribution).toContain("TMDB");
  await expect(catalog.resolve({ provider: "tmdb", id: "../../secret", kind: "movie" })).rejects.toThrow("Invalid");
});

test.each([[undefined, { start: 0, end: 99, partial: false }], ["bytes=10-20", { start: 10, end: 20, partial: true }], ["bytes=-10", { start: 90, end: 99, partial: true }], ["bytes=90-500", { start: 90, end: 99, partial: true }], ["bytes=100-", null], ["bytes=0-1,5-6", null], ["bytes=-0", null]])("stream ranges handle %s", (header, expected) => {
  expect(parseRange(header, 100)).toEqual(expected);
});

test("player policy allows MediaSource blobs and defers empty MediaSource initialization", () => {
  const fs = require("node:fs"); const path = require("node:path");

  const server = fs.readFileSync(path.join(__dirname, "../../lib/httpserver.js"), "utf8");
  const player = fs.readFileSync(path.join(__dirname, "../../client/movie-player.js"), "utf8");
  expect(server).toContain("media-src 'self' blob: https: http:");
  expect(player).toContain("attach(this.video, false)");
  expect(player).toContain("selectTextTrack(track || null)");
  expect(player).not.toContain(".setTextTrackVisibility(");
  expect(player).toContain("}, 5000)");
});

test("tracker snapshot formats addresses without the vulnerable classification package", () => {
  const formatter = require("../../vendor/bittorrent-tracker/lib/ip-format.cjs");

  expect(formatter.toString(Buffer.from([1, 2, 3, 4]))).toBe("1.2.3.4");
  expect(formatter.toString(0x7f000001)).toBe("127.0.0.1");
  expect(() => formatter.toString("127.1")).toThrow();
  expect(formatter.isPublic).toBeUndefined();
  expect(require("../../vendor/bittorrent-tracker/package.json").dependencies.ip).toBeUndefined();
});

test("stream relays accept only private generated socket locations and capabilities", () => {
  const os = require("node:os"); const path = require("node:path");

  const secret = "00000000-0000-4000-8000-000000000000";
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\hobbyfiles-stream-${secret}` : path.join(os.tmpdir(), "hobbyfiles-stream-synthetic", "relay.sock");
  expect(validRelay({ socket, secret })).toBe(true);
  const legacySocket = process.platform === "win32" ? `\\\\.\\pipe\\dicefiles-stream-${secret}` : path.join(os.tmpdir(), "dicefiles-stream-synthetic", "relay.sock");
  expect(validRelay({ socket: legacySocket, secret })).toBe(true);
  expect(validRelay({ socket: "/etc/passwd", secret })).toBe(false);
  expect(validRelay({ socket, secret: "" })).toBe(false);
});

test("private piece storage follows chunk-store slicing and callback contracts", async () => {
  const fs = require("node:fs/promises"); const os = require("node:os"); const path = require("node:path");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hobbyfiles-piece-test-"));
  try {
    const store = new PieceStore(8, { path: dir, length: 16 });
    const put = (index, buffer) => new Promise((resolve, reject) => store.put(index, buffer, error => error ? reject(error) : resolve()));
    const get = options => new Promise((resolve, reject) => store.get(0, options, (error, buffer) => error ? reject(error) : resolve(buffer)));
    expect(store.chunkLength).toBe(8); await put(0, Buffer.from("12345678"));
    expect((await get({ offset: 2, length: 3 })).toString()).toBe("345");
    expect((await get(null)).toString()).toBe("12345678");
    await expect(put(-1, Buffer.from("a"))).rejects.toThrow();
    store.close(); await expect(get({})).rejects.toThrow("not available");
  }
  finally {
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("hobbyfiles-piece-test-")) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});
