"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const videoHelpers = require("../../common/video");

function fixture(width = 1280, height = 720) {
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.paused = true; this.currentTime = 0; this.duration = 660;
    }
    appendChild(child) {
      this.children.push(child); return child;
    }
    append(...children) {
      children.forEach(child => this.appendChild(child));
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    removeAttribute(key) {
      delete this.attrs[key];
    }
    replaceChildren(...children) {
      this.children = children;
    }
    remove() {}
    focus() {}
    load() {}
    async play() {
      this.paused = false; this.dispatchEvent(new Event("play"));
    }
    pause() {
      this.paused = true; this.dispatchEvent(new Event("pause"));
    }
  }

  const dom = (tag, { attrs = {}, text = "" } = {}) => {
    const el = new Element(tag); el.attrs = attrs; el.textContent = text; return el;
  };

  class Modal {
    constructor() {
      this.el = dom("form"); this.body = dom("div");
      this.head = dom("div"); this.buttonsEl = dom("div"); this.buttons = [dom("button")];
      this.buttons[0].classList = { add: jest.fn() };
    } onshown() {}
  }

  class Player {
    static isBrowserSupported() {
      return true;
    }
    constructor() {
      this.configure = jest.fn(); this.selectTextTrack = jest.fn(); this.destroy = jest.fn(async () => {}); this.listeners = {};
    }
    async attach(video, initialize) {
      this.video = video; this.initialize = initialize;
    }
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
    async load(source, start, mime) {
      this.source = source; this.mime = mime; this.video.currentTime = start || 0;
    }
    async addTextTrackAsync() {
      return { id: 1 };
    }
  }

  const shaka = { Player, polyfill: { installAll() {} }, util: { Error: { Severity: { CRITICAL: 2 } } } };
  const document = new Element("document"); document.pictureInPictureEnabled = false; document.hidden = false;
  const storage = new Map(); const localStorage = { get length() {
    return storage.size;
  }, key: i => [...storage.keys()][i], getItem: key => storage.get(key), setItem: jest.fn((key, value) => storage.set(key, value)), removeItem: key => storage.delete(key) };
  const source = fs.readFileSync(path.join(__dirname, "../../client/movie-player.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class").replace(/^export \{.*\};$/gm, "");
  const context = { ...videoHelpers, shaka, Modal, dom, document, localStorage, innerWidth: width, innerHeight: height, getComputedStyle: () => ({ paddingLeft: "12", paddingRight: "12", paddingTop: "12", paddingBottom: "12", marginTop: "0", marginBottom: "0" }), requestAnimationFrame: jest.fn(() => 1), cancelAnimationFrame: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(), CustomEvent, setInterval, clearInterval, fetch: jest.fn(async () => new Response("#EXTM3U")), movieCall: jest.fn(), moviePath: () => "/media/file/synthetic/-1", movieReference: () => ({ kind: "file", key: "synthetic", index: -1 }), showMovieInfo: jest.fn() };
  const MoviePlayer = vm.compileFunction(`${source}\nreturn MoviePlayer;`, Object.keys(context))(...Object.values(context));
  return { MoviePlayer, localStorage, document, context };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("Shaka 5 subtitle selection uses selectTextTrack and five-second saves stop on close", async () => {
  const { MoviePlayer, localStorage } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4", subtitles: [{ id: "track", language: "en", label: "English" }] });
  await player.onshown();
  await player.toggle();
  expect(player.player.initialize).toBe(false); expect(player.player.source).toBe("/video.mp4");
  player.captions.value = "1"; player.captions.onchange(); expect(player.player.selectTextTrack).toHaveBeenLastCalledWith({ id: 1 });
  player.captions.value = ""; player.captions.onchange(); expect(player.player.selectTextTrack).toHaveBeenLastCalledWith(null);
  player.video.currentTime = 42; jest.advanceTimersByTime(4999); expect(localStorage.setItem).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.setItem.mock.calls[0][1]).position).toBe(42);
  player.video.currentTime = 44; player.onhidden(); const writes = localStorage.setItem.mock.calls.length;
  expect(player.player.destroy).toHaveBeenCalledTimes(1); jest.advanceTimersByTime(10000); expect(localStorage.setItem).toHaveBeenCalledTimes(writes);
});

test("opening a video resumes stored position and short videos never create watch progress", async () => {
  const { MoviePlayer, localStorage } = fixture();
  videoHelpers.saveWatch(localStorage, "file:synthetic:-1", 93, 660);
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4", subtitles: [] });
  await player.onshown(); expect(player.video.currentTime).toBe(93);
  localStorage.setItem.mockClear(); player.video.duration = 600; player.video.currentTime = 23; jest.advanceTimersByTime(10000); expect(localStorage.setItem).not.toHaveBeenCalled();
  player.onhidden(); expect(localStorage.setItem).not.toHaveBeenCalled();
});

test("episodes already 90% watched replay from the start and stay watched after replay saves", async () => {
  const { MoviePlayer, localStorage } = fixture();
  videoHelpers.saveWatch(localStorage, "file:synthetic:-1", 600, 660);
  const player = new MoviePlayer({ name: "Show.S01E01.mp4", url: "/episode.mp4" }, undefined, { name: "Show.S01E01.mp4" });
  await player.onshown();
  expect(player.video.currentTime).toBe(0);
  player.video.currentTime = 20; player.flush();
  expect(videoHelpers.watchRecords(localStorage)[0]).toMatchObject({ episode: true, completed: true });
  player.onhidden();
});

test("compact player groups fill transport, preference and view rows consistently", () => {
  const { MoviePlayer } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mp4" });
  const [transport, timeline, preferences, view] = player.controls.children;
  expect(transport.children.filter(child => child.tagName === "BUTTON")).toHaveLength(4);
  expect(timeline.children).toEqual([player.time, player.seek]);
  expect(preferences.children).toHaveLength(2); expect(view.children).toHaveLength(2);
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/movie.css"), "utf8");
  expect(css).toContain("grid-auto-columns: minmax(0, 1fr)");
  expect(css).toContain("max-width: none; min-height: 44px");
  expect(css).toContain(".movie-controls[hidden] { display: none; }");
});

test("opening buffers immediately without autoplay and places the close button in the header", async () => {
  const { MoviePlayer } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4" });
  expect(player.head.children).toContain(player.closeButton);
  expect(player.closeButton.attrs["aria-label"]).toBe("Close video player");
  expect(player.video.attrs.preload).toBe("auto");
  await player.onshown();
  expect(player.player.source).toBe("/video.mp4");
  expect(player.video.paused).toBe(true);
  expect(player.playbackAttempted).toBe(false);
  expect(player.feedback.textContent).toBe(""); expect(player.feedback.hidden).toBe(true);
  player.onhidden();
});

test("empty native errors and recoverable Shaka retries do not report playback failure", async () => {
  const { MoviePlayer } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4" });
  await player.onshown();
  player.video.dispatchEvent(new Event("error"));
  player.player.listeners.error({ detail: { severity: 1, code: 1002 } });
  expect(player.loadFailed).toBe(false);
  expect(player.feedback.textContent).toBe("");
  player.onhidden();
});

test("preparation failures offer a real retry before any playback failure message", async () => {
  const { MoviePlayer, context } = fixture();
  const originalLoad = context.shaka.Player.prototype.load;
  const load = jest.spyOn(context.shaka.Player.prototype, "load").mockRejectedValueOnce(new Error("synthetic load failure")).mockImplementation(originalLoad);
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4" });
  await player.onshown();
  expect(player.feedback.textContent).toContain("Video preparation did not finish");
  expect(player.feedback.textContent).not.toContain("could not play");
  await player.toggle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(player.video.paused).toBe(false);
  expect(player.loadFailed).toBe(false);
  player.onhidden();
});

test("MKV torrents prepare a browser-compatible HLS source and play automatically when ready", async () => {
  const { MoviePlayer, context } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mkv" }, { kind: "file", key: "synthetic", index: 0 }, { name: "Synthetic.mkv" });
  await player.onshown();
  expect(context.fetch).toHaveBeenCalledTimes(1);
  expect(player.player.source).toBe("/media/file/synthetic/-1/hls.m3u8");
  expect(player.player.mime).toBe("application/x-mpegurl");
  expect(player.video.paused).toBe(false);
  expect(player.playbackAttempted).toBe(true);
  const {signal} = context.fetch.mock.calls[0][1];
  player.onhidden(); expect(signal.aborted).toBe(true);
});

test("progressive torrent autoplay resumes its timestamp and never overrides a later pause", async () => {
  const { MoviePlayer, localStorage } = fixture();
  videoHelpers.saveWatch(localStorage, "file:synthetic:0", 93, 660);
  const player = new MoviePlayer({ name: "Synthetic.mp4" }, { kind: "file", key: "synthetic", index: 0 }, { name: "Synthetic.mp4" });
  const play = jest.spyOn(player.video, "play");
  await player.onshown();
  expect(player.player.source).toContain("/stream");
  expect(player.video.currentTime).toBe(93); expect(player.video.paused).toBe(false);
  expect(play).toHaveBeenCalledTimes(1);
  await player.toggle();
  player.video.dispatchEvent(new Event("canplay"));
  expect(player.video.paused).toBe(true); expect(play).toHaveBeenCalledTimes(1);
  player.onhidden();
});

test("browser autoplay refusal leaves a usable Play button without marking the stream failed", async () => {
  const { MoviePlayer } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mkv" }, { kind: "link", key: "synthetic", index: 0 }, { name: "Synthetic.mkv" });
  const play = jest.spyOn(player.video, "play").mockRejectedValueOnce(Object.assign(new Error("policy"), { name: "NotAllowedError" }));
  await player.onshown();
  expect(player.video.paused).toBe(true); expect(player.loadFailed).toBe(false);
  expect(player.playButton.disabled).toBe(false);
  expect(player.feedback.textContent).toBe("Your browser blocked automatic playback. Press Play to start.");
  await player.toggle();
  expect(play).toHaveBeenCalledTimes(2); expect(player.video.paused).toBe(false);
  player.onhidden();
  await player.startPlayback(true);
  expect(play).toHaveBeenCalledTimes(2);
});

test("torrent preparation presents the server's recovery message and retries", async () => {
  const { MoviePlayer, context } = fixture();
  context.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "This video needs browser conversion, but native video tools are disabled. Ask the operator to enable them." }), { status: 503 }));
  const player = new MoviePlayer({ name: "Synthetic.mkv" }, { kind: "file", key: "synthetic", index: 0 }, { name: "Synthetic.mkv" });
  await player.onshown();
  expect(player.loadFailed).toBe(true);
  expect(player.feedback.textContent).toContain("Ask the operator to enable them");
  await player.toggle(); expect(player.loadFailed).toBe(false); expect(player.video.paused).toBe(false);
  player.onhidden();
});

test("buffering refreshes real counters every two seconds and hides status when ready", async () => {
  const { MoviePlayer, context } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mkv" }, { kind: "file", key: "synthetic", index: 0 }, { name: "Synthetic.mkv" });
  await player.onshown();
  context.fetch.mockClear();
  context.fetch.mockResolvedValue(new Response(JSON.stringify({ phase: "buffering", downloadedParts: 7, totalParts: 99, bytesPerSecond: 1048576, etaSeconds: 4 })));
  player.video.dispatchEvent(new Event("waiting"));
  expect(player.feedback.hidden).toBe(false); expect(player.feedback.attrs["data-buffering"]).toBe("true");
  await jest.advanceTimersByTimeAsync(1999); expect(context.fetch).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(context.fetch).toHaveBeenCalledTimes(1); expect(context.fetch.mock.calls[0][0]).toContain("/progress");
  expect(player.feedback.textContent).toContain("7 / 99 parts · 1.0 MiB/s · ~4s to buffer");
  player.video.dispatchEvent(new Event("canplay"));
  expect(player.feedback.textContent).toBe(""); expect(player.feedback.hidden).toBe(true);
  await jest.advanceTimersByTimeAsync(4000); expect(context.fetch).toHaveBeenCalledTimes(1);
  player.onhidden();
});

test("closing aborts an in-flight sample and late progress cannot replace a playback error", async () => {
  const { MoviePlayer, context } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mkv" }, { kind: "file", key: "synthetic", index: 0 }, { name: "Synthetic.mkv" });
  await player.onshown();
  let deliver;
  context.fetch.mockImplementation(() => new Promise(resolve => deliver = resolve));
  player.video.dispatchEvent(new Event("waiting"));
  await jest.advanceTimersByTimeAsync(2000);
  const {signal} = context.fetch.mock.calls.at(-1)[1];
  player.playbackError(new Error("synthetic"));
  expect(signal.aborted).toBe(true);
  deliver(new Response(JSON.stringify({ downloadedParts: 9, totalParts: 99 })));
  await jest.advanceTimersByTimeAsync(0);
  expect(player.feedback.textContent).toContain("Playback stopped");
  expect(player.feedback.attrs["data-buffering"]).toBe("false");
  player.onhidden();
  await jest.advanceTimersByTimeAsync(4000);
  expect(context.fetch).toHaveBeenCalledTimes(2);
});

test.each([[1280, 720, 1920, 1080], [390, 844, 1080, 1920], [740, 360, 1920, 1080]])("player fits its frame and controls inside %i × %i", (width, height, videoWidth, videoHeight) => {
  const { MoviePlayer, context } = fixture(width, height);
  const player = new MoviePlayer({ name: "Synthetic.mp4" });
  player.el.style = { setProperty: jest.fn() };
  player.el.getBoundingClientRect = () => ({ width: 1000 });
  player.head.offsetHeight = 44; player.title.offsetHeight = 28;
  player.feedback.offsetHeight = 24; player.controls.offsetHeight = 182;
  player.video.videoWidth = videoWidth; player.video.videoHeight = videoHeight;
  player.fit(); context.requestAnimationFrame.mock.calls[0][0]();
  expect(parseFloat(player.el.style.height)).toBeLessThanOrEqual(height - 24);
  expect(parseFloat(player.el.style.width)).toBeLessThanOrEqual(width - 24);
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/movie.css"), "utf8");
  expect(css).toContain("grid-template-rows: minmax(0, 1fr) auto auto");
});
