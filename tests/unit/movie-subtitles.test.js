"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { subtitleLanguages } = require("../../common/subtitle-languages");
const { normalizeSubtitle } = require("../../lib/media/subtitles");

test("subtitle languages start with English and include European and major world languages", () => {
  expect(subtitleLanguages[0]).toEqual({ language: "en", label: "English" });
  const codes = subtitleLanguages.map(option => option.language);
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes).toEqual(expect.arrayContaining("bg uk be pl ro hu sk sl cs hr bs sr sr-ME mk sq el tr et lv lt fi sv da nb nn is fo de fr it es pt mt ga cy gd eu ca gl rm lb se zh-Hans zh-Hant hi ar ja ko sw".split(" ")));
  expect(subtitleLanguages.find(option => option.language === "bg").label).toBe("Bulgarian");
});

test("subtitle filenames are optional, bounded and contain no client paths or control characters", () => {
  const text = "WEBVTT\n\n00:01.000 --> 00:02.000\nHello";
  expect(normalizeSubtitle(text, "bg", "C:\\fakepath\\Example\u0000.bg.srt")).toMatchObject({ language: "bg", label: "Bulgarian", filename: "Example.bg.srt" });
  expect(normalizeSubtitle(text, "en").filename).toBeUndefined();
  expect(normalizeSubtitle(text, "en", "a".repeat(1000)).filename).toHaveLength(255);
});

function fixture(data) {
  const dom = (tag, { classes = [], attrs = {}, text = "" } = {}) => ({ tag, classes, attrs, textContent: text, children: [],
    appendChild(child) {
      this.children.push(child); return child;
    },
    append(...children) {
      children.forEach(child => this.appendChild(child));
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    replaceChildren(...children) {
      this.children = children;
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "../../client/movie.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const { MovieModal, movieMedia } = vm.compileFunction(`${source}\nreturn {MovieModal, movieMedia};`, ["Modal", "dom", "subtitleLanguages", "registry", "mediaTitle"])(class {}, dom, subtitleLanguages, {}, (_movie, fallback) => fallback);
  const modal = Object.create(MovieModal.prototype); modal.body = dom("div"); modal.data = data;
  modal.feedback = dom("p"); modal.reference = {}; modal.run = jest.fn(async action => action());
  modal.renderSubtitles();
  return { modal, section: modal.body.children[0], movieMedia };
}

test("subtitle controls share one two-column form above all language/file pairs", () => {
  const { section } = fixture({ editable: true, subtitles: [{ id: "one", label: "English", filename: "film.en.srt" }, { id: "two", label: "Bulgarian" }] });
  const form = section.children[1]; expect(form.classes).toContain("movie-subtitle-form");
  expect(form.children).toHaveLength(2);
  const select = form.children[0].children[0]; expect(select.tag).toBe("select"); expect(select.value).toBe("en");
  expect(form.children[1].children[1].attrs.type).toBe("file");
  const list = section.children[2]; expect(list.tag).toBe("ul"); expect(list.children).toHaveLength(2);
  expect(list.children[0].children[0].children.map(child => child.textContent)).toEqual(["English", "film.en.srt"]);
  expect(list.children[1].children[0].children[1].textContent).toBe("Converted subtitles (VTT)");
});

test("read-only viewers see every subtitle pair without editing controls", () => {
  const { section } = fixture({ editable: false, subtitles: [{ id: "one", label: "English", filename: "film.en.srt" }] });
  expect(section.children[1].tag).toBe("ul");
  expect(section.children[1].children[0].children).toHaveLength(1);
});

test("video details place the combined trailer/scenes row before cast", () => {
  const { modal } = fixture({ editable: false, movie: { trailer: "https://example.org/trailer", screenshots: ["https://example.org/scene.jpg"], cast: [{ name: "Actor", role: "Character" }] } });
  modal.file = { name: "Example.mp4" }; modal.render();
  const {children} = modal.body;
  const mediaIndex = children.findIndex(child => child.classes.includes("movie-media"));
  const castIndex = children.findIndex(child => child.textContent === "Cast");
  expect(mediaIndex).toBeGreaterThan(0); expect(mediaIndex).toBeLessThan(castIndex);
  const row = children[mediaIndex].children[1];
  expect(row.children.map(child => child.attrs.href)).toEqual(["https://example.org/trailer", "https://example.org/scene.jpg"]);
  expect(row.children[0].attrs["aria-label"]).toBe("Watch trailer");
  expect(row.children[0].children[0].attrs.src).toBe("https://example.org/scene.jpg");
  const heroLinks = children[0].children[0].children[1];
  expect(heroLinks.children.some(child => child.attrs.href === "https://example.org/trailer")).toBe(false);
});

test("media row supports trailer-only and scene-only titles and omits missing media", () => {
  const { movieMedia } = fixture({ editable: false });
  expect(movieMedia(null)).toBeNull();
  expect(movieMedia({ screenshots: [] })).toBeNull();
  const trailer = movieMedia({ trailer: "https://example.org/trailer" });
  expect(trailer.children[0].textContent).toBe("Trailer");
  expect(trailer.children[1].children).toHaveLength(1);
  expect(trailer.children[1].children[0].children.some(child => child.tag === "img")).toBe(false);
  const scenes = movieMedia({ screenshots: ["https://example.org/scene.jpg"] });
  expect(scenes.children[0].textContent).toBe("Scenes");
  expect(scenes.children[1].children[0].attrs["aria-label"]).toBe("Open scene image");
});
