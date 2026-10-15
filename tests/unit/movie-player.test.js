"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const videoHelpers = require("../../common/video");

function fixture() {
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
    } onshown() {}
  }

  class Player {
    static isBrowserSupported() {
      return true;
    }
    constructor() {
      this.configure = jest.fn(); this.selectTextTrack = jest.fn(); this.destroy = jest.fn(async () => {});
    }
    async attach(video, initialize) {
      this.video = video; this.initialize = initialize;
    }
    addEventListener() {}
    async load(source, start) {
      this.source = source; this.video.currentTime = start || 0;
    }
    async addTextTrackAsync() {
      return { id: 1 };
    }
  }

  const shaka = { Player, polyfill: { installAll() {} } };
  const document = new Element("document"); document.pictureInPictureEnabled = false; document.hidden = false;
  const storage = new Map(); const localStorage = { get length() {
    return storage.size;
  }, key: i => [...storage.keys()][i], getItem: key => storage.get(key), setItem: jest.fn((key, value) => storage.set(key, value)), removeItem: key => storage.delete(key) };
  const source = fs.readFileSync(path.join(__dirname, "../../client/movie-player.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class").replace(/^export \{.*\};$/gm, "");
  const context = { ...videoHelpers, shaka, Modal, dom, document, localStorage, addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(), CustomEvent, setInterval, clearInterval, movieCall: jest.fn(), moviePath: () => "/media/file/synthetic/-1", movieReference: () => ({ kind: "file", key: "synthetic", index: -1 }), showMovieInfo: jest.fn() };
  const MoviePlayer = vm.compileFunction(`${source}\nreturn MoviePlayer;`, Object.keys(context))(...Object.values(context));
  return { MoviePlayer, localStorage, document, context };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("Shaka 5 subtitle selection uses selectTextTrack and five-second saves stop on close", async () => {
  const { MoviePlayer, localStorage } = fixture();
  const player = new MoviePlayer({ name: "Synthetic.mp4", url: "/video.mp4" }, undefined, { name: "Synthetic.mp4", subtitles: [{ id: "track", language: "en", label: "English" }] });
  await player.onshown();
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
