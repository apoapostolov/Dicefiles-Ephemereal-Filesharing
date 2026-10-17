"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { torrentArtwork } = require("../../common/torrent-presentation");

const poster = "https://image.tmdb.org/t/p/w780/poster.jpg";
const logo = "https://image.tmdb.org/t/p/w500/logo.png";
const embedded = "data:image/jpeg;base64,c3ludGhldGlj";

function fixture(meta) {
  class Element {
    constructor(tag, { classes = [], attrs = {} } = {}) {
      this.tagName = tag; this.children = []; this.attributes = attrs; Object.assign(this, attrs);
      const names = new Set(classes);
      this.classList = { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) };
    }
    appendChild(child) {
      this.children.push(child); child.parent = this; return child;
    }
    replaceChild(next, previous) {
      const index = this.children.indexOf(previous); if (index < 0) {
        throw new Error("Detached preview");
      } this.children[index] = next; next.parent = this; previous.parent = null;
    }
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null;
      }
    }
  }

  const dom = (tag, options) => new Element(tag, options);
  const images = [];

  class Image {
    constructor() {
      images.push(this);
    }
  }

  const source = fs.readFileSync(path.join(__dirname, "../../client/files/file.js"), "utf8").replace(/^import .*;$/gm, "").replace("export default class File", "class File");
  const File = vm.compileFunction(`${source}\nreturn File;`, ["BaseFile", "APOOL", "torrentArtwork", "dom", "Image"])(class {}, { wrap: fn => fn }, torrentArtwork, dom, Image);
  const file = Object.create(File.prototype);
  Object.assign(file, { meta, displayName: "Example · Season 1", href: "/g/synthetic", previewContEl: dom("a"), previewEl: dom("span", { classes: ["loading"] }), findPreview: jest.fn(() => null), createPreviewPlaceholder: jest.fn(() => dom("span")) });
  file.previewContEl.appendChild(file.previewEl);
  return { file, images };
}

test("torrent artwork prefers the matched title, then the largest matched video with a poster", () => {
  const torrent = { files: [{ path: "one.mkv", size: 10 }, { path: "two.mkv", size: 20 }], imageDataUrl: embedded };
  const cinema = { 0: { movie: { poster: "one" } }, 1: { movie: { poster: "two", logo } } };
  expect(torrentArtwork(torrent, cinema)).toMatchObject({ poster: "two", logo });
  expect(torrentArtwork(torrent, cinema, { poster, logo })).toEqual({ poster, logo, fallback: embedded });
  expect(torrentArtwork({ imageDataUrl: embedded })).toEqual({ poster: embedded, logo: null, fallback: null });
  expect(torrentArtwork({})).toBeNull(); expect(torrentArtwork(null, cinema)).toBeNull();
});

test("a resolved poster replaces a placeholder and contains a decorative clearlogo", () => {
  const { file } = fixture({ torrent: { files: [{ path: "Show.S01E01.mkv" }] }, cinema: { 0: { movie: { poster, logo } } } });
  file.adjustPreview();
  const artwork = file.previewEl; const [cover, overlay] = artwork.children;
  expect(cover.src).toBe(poster); expect(cover.alt).toBe("Poster for Example · Season 1");
  expect(cover.referrerpolicy).toBe("no-referrer"); expect(overlay.attributes["aria-hidden"]).toBe("true");
  expect(overlay.children[0]).toMatchObject({ src: logo, alt: "" });
  expect(file.findPreview).not.toHaveBeenCalled(); expect(artwork.classList.contains("has-clearlogo")).toBe(true);
  overlay.children[0].onerror(); expect(artwork.children).toEqual([cover]); expect(artwork.classList.contains("has-clearlogo")).toBe(false);
});

test("failed posters fall back to embedded artwork and then the standard placeholder", () => {
  const { file } = fixture({ torrent: { imageDataUrl: embedded } }); file.displayMovie = { poster, logo }; file.adjustPreview();
  const artwork = file.previewEl; const cover = artwork.children[0];
  cover.onerror(); expect(cover.src).toBe(embedded); expect(artwork.children).toHaveLength(1);
  cover.onerror(); expect(file.previewEl).not.toBe(artwork); expect(file.createPreviewPlaceholder).toHaveBeenCalledTimes(1);
});

test("late artwork failures and older generated thumbnails cannot replace newer posters", () => {
  const { file, images } = fixture({}); file.findPreview.mockReturnValue({ type: "image", ext: ".thumbnail" }); file.adjustPreview();
  file.meta = { torrent: { imageDataUrl: embedded } }; file.previewEl.classList.add("loading"); file.adjustPreview();
  const first = file.previewEl; const oldCover = first.children[0]; images[0].onload(); expect(file.previewEl).toBe(first);
  file.displayMovie = { poster }; file.previewEl.classList.add("loading"); file.adjustPreview();
  const current = file.previewEl; oldCover.onerror(); expect(file.previewEl).toBe(current);
  expect(current.children[0].src).toBe(poster);
});
