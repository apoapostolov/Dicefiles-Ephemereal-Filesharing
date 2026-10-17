"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fileKind, presentTorrent, availabilityView, featuredMovie } = require("../../common/torrent-presentation");
const { torrentWatchTarget } = require("../../common/torrent-media");

function fixture(mobile = true) {
  const document = { listeners: {}, activeElement: null, addEventListener(name, fn) {
    this.listeners[name] = fn;
  } };

  class Element {
    constructor() {
      this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.classes = []; this.value = "";
      this.classList = { add: value => this.classes.push(value) };
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    removeAttribute(key) {
      delete this.attributes[key];
    }
    appendChild(child) {
      this.children.push(child); child.parent = this; return child;
    }
    append(...children) {
      children.forEach(child => this.appendChild(child));
    }
    replaceChildren() {
      this.children = [];
    }
    remove() {
      this.parent.children = this.parent.children.filter(child => child !== this);
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    contains(target) {
      return target === this || this.children.some(child => child.contains(target));
    }
    getBoundingClientRect() {
      return { left: 310, top: 100, bottom: 130, width: 200, height: 70 };
    }
    focus() {
      document.activeElement = this;
    }
    click() {
      this.listeners.click?.({ preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() });
    }
  }

  document.createElement = () => new Element(); document.body = new Element();
  const dom = (_tag, { classes = [], text = "", attrs = {} } = {}) => {
    const el = new Element(); el.classes = classes; el.textContent = text; el.attributes = attrs; return el;
  };
  const source = fs.readFileSync(path.join(__dirname, "../../client/compact-tag.js"), "utf8").replace("export function", "function");
  const compactTag = vm.compileFunction(`${source}\nreturn compactTag;`, ["document", "addEventListener", "matchMedia", "innerWidth", "innerHeight"])(document, jest.fn(), () => ({ matches: mobile }), 360, 640);
  return { document, Element, dom, compactTag };
}

test("mobile poster pills reveal the full name, stay in the viewport and dismiss with Escape", () => {
  const { document, Element, compactTag } = fixture(); const tag = new Element();
  const fullName = "A complete poster name with no truncation"; compactTag(tag, fullName);
  tag.click(); const popup = document.body.children[0];
  expect(popup.textContent).toBe(fullName); expect(popup.style.left).toBe("152px");
  expect(tag.attributes["aria-expanded"]).toBe("true");
  document.listeners.keydown({ key: "Escape", preventDefault: jest.fn(), stopPropagation: jest.fn() });
  expect(document.body.children).toHaveLength(0); expect(tag.attributes["aria-expanded"]).toBe("false");
});

test("page pills support keyboard activation and desktop clicks retain their existing behavior", () => {
  const mobile = fixture(); const tag = new mobile.Element(); mobile.compactTag(tag, "12 pages");
  tag.listeners.keydown({ key: "Enter", preventDefault: jest.fn() });
  expect(mobile.document.body.children[0].textContent).toBe("12 pages");
  mobile.document.listeners.pointerdown({ target: mobile.document.body }); expect(mobile.document.body.children).toHaveLength(0);
  const desktop = fixture(false); const poster = new desktop.Element(); desktop.compactTag(poster, "Poster"); poster.click();
  expect(desktop.document.body.children).toHaveLength(0);
});

test("torrent refresh preserves the contents search and keyboard focus", async () => {
  const { document, dom } = fixture();

  class Modal {
    constructor() {
      this.body = dom("div");
    }
  }

  const registry = { socket: { makeCall: jest.fn(async () => ({ torrent: { availability: { seeders: 2 } } })) } };
  const source = fs.readFileSync(path.join(__dirname, "../../client/torrent-metadata.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class");
  const TorrentModal = vm.compileFunction(`${source}\nreturn TorrentMetadataModal;`, ["Modal", "registry", "dom", "toPrettySize", "fileKind", "presentTorrent", "document", "userError", "mediaFileTitle", "availabilityView", "featuredMovie", "torrentWatchTarget"])(Modal, registry, dom, n => `${n} B`, fileKind, presentTorrent, document, require("../../common/user-error").userError, require("../../common/torrent-media").mediaFileTitle, availabilityView, featuredMovie, torrentWatchTarget);
  const modal = new TorrentModal({ name: "Books", files: [{ path: "a.pdf", size: 4 }, { path: "b.epub", size: 8 }], trackers: [] }, "books.torrent", "/download", { kind: "file", key: "synthetic" });
  expect(modal.watchButton.hidden).toBe(true);
  modal.search.value = "epub"; modal.search.oninput(); modal.search.focus();
  await modal.refresh(true);
  expect(modal.search.value).toBe("epub"); expect(document.activeElement).toBe(modal.search);
  expect(modal.refreshButton.disabled).toBe(false);
  expect(registry.socket.makeCall.mock.calls[0][0]).toBe("torrentdetails");
  const treeText = el => [el.textContent, ...el.children.map(treeText)].join(" ");
  expect(treeText(modal.body)).toContain("b.epub"); expect(treeText(modal.body)).not.toContain("a.pdf");
  expect(treeText(modal.body)).not.toContain("Info hash");
});

test("the right-aligned Watch action reads fresh progress and Continue Watching drops completed episodes", async () => {
  const { document, dom } = fixture();
  const records = new Map();
  const storage = { get length() {
    return records.size;
  }, key: index => [...records.keys()][index], getItem: key => records.get(key), setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };

  class Modal {
    constructor() {
      this.body = dom("div");
    }
  }

  const openMoviePlayer = jest.fn(async () => {});
  const context = { Modal, registry: {}, dom, toPrettySize: String, fileKind, presentTorrent, document, userError: String, availabilityView, featuredMovie, ...require("../../common/torrent-media"), ...require("../../common/video"), localStorage: storage, openMoviePlayer };
  const source = fs.readFileSync(path.join(__dirname, "../../client/torrent-metadata.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class");
  const TorrentModal = vm.compileFunction(`${source}\nreturn TorrentMetadataModal;`, Object.keys(context))(...Object.values(context));
  const torrent = { name: "Series Season 1", files: [{ path: "Series.S01E02.mkv", size: 1000 }, { path: "Series.S01E01.mkv", size: 1000 }] };
  const reference = { kind: "link", key: "synthetic" };
  const modal = new TorrentModal(torrent, "Series", null, reference);
  expect(modal.watchButton.hidden).toBe(false);
  await modal.watchButton.onclick();
  expect(openMoviePlayer.mock.calls.at(-1)[1]).toEqual({ ...reference, index: 1 });
  context.saveWatch(storage, "link:synthetic:1", 900, 1000);
  await modal.watchButton.onclick();
  expect(openMoviePlayer.mock.calls.at(-1)[1].index).toBe(0);
  context.saveWatch(storage, "link:synthetic:0", 450, 1000);
  const continuity = fs.readFileSync(path.join(__dirname, "../../client/watch-continuity.js"), "utf8").replace(/^import .*;$/gm, "").replace("export function", "function");
  const render = vm.compileFunction(`${continuity}\nreturn renderWatchContinuity;`, Object.keys(context))(...Object.values(context));
  const container = dom("div");
  expect(render(container, [], [{ id: "synthetic", meta: { torrent } }])).toBe(true);
  expect(container.children).toHaveLength(1);
  context.saveWatch(storage, "link:synthetic:0", 900, 1000, Date.now(), true);
  expect(render(container, [], [{ id: "synthetic", meta: { torrent } }])).toBe(false);
  modal.updateWatchAction();
  expect(modal.watchButton.textContent).toBe("▶ Watch again");
  await modal.watchButton.onclick();
  expect(openMoviePlayer.mock.calls.at(-1)[1].index).toBe(1);
  const feedback = modal.feedback.textContent;
  openMoviePlayer.mockRejectedValueOnce(undefined);
  await modal.watchButton.onclick();
  expect(modal.feedback.textContent).toBe(feedback);
  expect(modal.watchButton.disabled).toBe(false);
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/torrent.css"), "utf8");
  expect(css).toContain(".modal-torrent .torrent-watch-action { margin-inline-start: auto; flex-shrink: 0; }");
});

test("matched torrent artwork appears in the main dialog and video actions share their file row", async () => {
  const { document, dom } = fixture();

  class Modal {
    constructor() {
      this.body = dom("div");
    }
  }

  const movie = { title: "Confirmed film", kind: "movie", year: "2020", backdrop: "https://image.tmdb.org/backdrop.jpg", poster: "https://image.tmdb.org/poster.jpg", logo: "https://image.tmdb.org/logo.png", attribution: "TMDB" };
  const cinema = { 1: { movie } };
  const registry = { links: { linkmap: new Map([["synthetic", { meta: { cinema } }]]) } };
  const source = fs.readFileSync(path.join(__dirname, "../../client/torrent-metadata.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class");
  const showMovieInfo = jest.fn(async file => {
    file.meta.cinema = { 1: { movie: null } };
  });
  const TorrentModal = vm.compileFunction(`${source}\nreturn TorrentMetadataModal;`, ["Modal", "registry", "dom", "toPrettySize", "fileKind", "presentTorrent", "document", "userError", "mediaFileTitle", "availabilityView", "featuredMovie", "showMovieInfo", "torrentWatchTarget"])(Modal, registry, dom, n => `${n} B`, fileKind, presentTorrent, document, String, require("../../common/torrent-media").mediaFileTitle, availabilityView, featuredMovie, showMovieInfo, torrentWatchTarget);
  const modal = new TorrentModal({ files: [{ path: "readme.txt", size: 1 }, { path: "movie.mp4", size: 100 }], trackers: [] }, "Original torrent", null, { kind: "link", key: "synthetic" });
  const find = (el, cls) => el.classes.includes(cls) ? el : el.children.map(child => find(child, cls)).find(Boolean);
  const hero = find(modal.body, "torrent-cinema-hero");
  expect(hero).toBeDefined(); expect(find(hero, "torrent-backdrop").attributes.src).toBe(movie.backdrop);
  expect(find(hero, "torrent-movie-logo").attributes.src).toBe(movie.logo);
  const header = find(modal.body, "torrent-contents-header");
  expect(header.children).toHaveLength(3); expect(header.children[2]).toBe(modal.search);
  const list = find(modal.body, "torrent-file-list"); const row = list.children[1];
  expect(row.children).toHaveLength(4);
  const controls = find(row, "torrent-file-controls"); expect(controls.children).toHaveLength(2);
  expect(controls.children[0].attributes["aria-label"]).toBe("Watch movie.mp4");
  await controls.children[1].onclick();
  expect(showMovieInfo).toHaveBeenCalledTimes(1);
  expect(find(modal.body, "torrent-cinema-hero")).toBeUndefined();
});

test("torrent hero uses the largest confirmed video and preserves episode identity", () => {
  const torrent = { files: [{ path: "sample.mp4", size: 1 }, { path: "episode.mkv", size: 10 }, { path: "notes.txt", size: 1000 }] };
  const cinema = { 0: { movie: { title: "Sample" } }, 1: { movie: { title: "Episode", kind: "episode", season: 0, episode: 1 } }, 2: { movie: { title: "Not a video" } } };
  expect(featuredMovie(torrent, cinema)).toMatchObject({ index: 1, count: 2, movie: { kind: "episode", season: 0 } });
  expect(featuredMovie(torrent, {})).toBeNull();
});

test("phone torrent metadata occupies its own row to preserve filename width", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/files.css"), "utf8");
  expect(css).toContain(".file.torrent-entry > .tags { grid-row: 2; grid-column: 2 / -1;");
  expect(css).toContain(".file.torrent-entry > .name { grid-row: 1; grid-column: 2; min-width: 0;");
});

test("torrent availability metrics have centered icon/value cells and accent hover without a shadow border", () => {
  const { dom } = fixture(); const onopen = jest.fn();
  const source = fs.readFileSync(path.join(__dirname, "../../client/torrent-availability.js"), "utf8").replace(/^import .*;$/gm, "").replace("export function", "function");
  const render = vm.compileFunction(`${source}\nreturn torrentAvailability;`, ["dom", "availabilityView"])(dom, availabilityView);
  const pill = render({ availability: { seeders: 12, leechers: 345, responding: 1, state: "current", reportedAt: Date.now() } }, onopen);
  expect(pill.children).toHaveLength(2);
  expect(pill.children[0].children[0].classes).toEqual(["torrent-metric-icon", "is-seeders"]);
  expect(pill.children[1].children[0].classes).toEqual(["torrent-metric-icon", "is-peers"]);
  expect(pill.children.map(group => group.children[1].textContent)).toEqual(["12", "345"]);
  expect(pill.attributes["aria-label"]).toContain("12 seeders");
  pill.onclick({ preventDefault: jest.fn(), stopPropagation: jest.fn() }); expect(onopen).toHaveBeenCalledTimes(1);
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/torrent.css"), "utf8");
  expect(css).toContain("grid-template-columns: 10px auto");
  expect(css).toContain(".torrent-availability span { display: block; padding: 0; margin: 0; color: inherit;");
  expect(css).toContain(".tag.torrent-availability:is(:hover, :focus) { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-soft); box-shadow: none;");
  expect(css).toContain("transform: translateY(0.5px) rotate(180deg)");
  expect(css).toContain("font-size: 10px; line-height: normal;");
  expect(css).not.toContain("height: 24px");
  expect(css).toContain(".tag.torrent-availability:focus-visible { outline: 2px solid var(--accent)");
});

test("torrent and magnet rows omit redundant title pills while other files retain titles", () => {
  const { dom } = fixture();
  const source = fs.readFileSync(path.join(__dirname, "../../client/files/file.js"), "utf8");
  const method = source.split("  setupTags() {")[1].split("\n  getTypeLabel() {")[0];
  const modelSource = fs.readFileSync(path.join(__dirname, "../../client/files/model-formats.js"), "utf8").replace("export function", "function");
  const isSupportedModelName = vm.compileFunction(`${modelSource}\nreturn isSupportedModelName;`)();
  const tagDom = (...args) => {
    const el = dom(...args); el.dataset = {}; return el;
  };
  const setup = vm.compileFunction(`return function() {${method}`, ["dom", "sort", "torrentAvailability", "registry", "isSupportedModelName"])(tagDom, rows => rows, () => dom("button", { classes: ["torrent-availability"] }), {}, isSupportedModelName);
  const render = meta => {
    const file = { meta, name: "notes.txt", type: "file", tagsMap: new Map([["title", "Duplicate name"]]), tagsEl: dom("span"), el: { classList: { remove: jest.fn(), toggle: jest.fn() }, insertBefore: jest.fn() }, isBookLike: () => false, isArchiveFile: () => false, getTagLabel: tag => tag };
    setup.call(file); return file.tagsEl.children;
  };
  expect(render({ torrent: { kind: "magnet" } }).some(tag => tag.classes.includes("tag-title"))).toBe(false);
  expect(render({ torrent: { kind: "torrent" } }).some(tag => tag.classes.includes("tag-title"))).toBe(false);
  expect(render({}).some(tag => tag.classes.includes("tag-title"))).toBe(true);
});

test("Video Information keeps its accented Watch action after IMDb in one action bar", () => {
  const { dom } = fixture();
  const source = fs.readFileSync(path.join(__dirname, "../../client/movie.js"), "utf8");
  const heroSource = source.slice(source.indexOf("function button("), source.indexOf("export class MovieModal")).replace("export function", "function");
  const { movieHero, button } = vm.compileFunction(`${heroSource}\nreturn { movieHero, button };`, ["dom", "mediaTitle"])(dom, require("../../common/torrent-media").mediaFileTitle);
  const watch = button("▶ Watch", () => {}, "movie-primary movie-watch-action");
  const hero = movieHero({ title: "Example", url: "https://www.themoviedb.org/movie/1", imdb: "https://www.imdb.com/title/tt1234567/" }, "file.mp4", false, watch);
  const actions = hero.children[0].children.find(child => child.classes.includes("movie-actions"));
  expect(actions.children.at(-1)).toBe(watch);
  expect(actions.children.at(-2).textContent).toBe("IMDb ↗");
  expect(watch.classes).toContain("movie-primary"); expect(watch.classes).toContain("movie-watch-action");
  expect(watch.classes.some(value => value.includes(" "))).toBe(false);
  expect(source).toContain("super(\"movie\", \"Video Information\"");
});

test("Appearance uses a palette SVG and mobile page count uses a document glyph", () => {
  const theme = fs.readFileSync(path.join(__dirname, "../../entries/theme.js"), "utf8");
  expect(theme).toContain("theme-icon"); expect(theme).toContain("<svg"); expect(theme).not.toContain("theme-launcher i-pref");
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/files.css"), "utf8");
  expect(css).toContain(".compact-tag.tag-pages::before"); expect(css).toContain("content: attr(data-tag-value)");
  expect(css).toContain("flex: 0 0 26px; width: 26px; min-width: 26px; max-width: 26px");
  expect(css).not.toContain("max-width: 15%");
});
